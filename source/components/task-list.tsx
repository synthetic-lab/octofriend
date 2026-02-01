import React from "react";
import { Box, Text, useInput } from "ink";
import { useTaskStore, useTaskStoreShallow, Task, TaskProgress } from "../task-manager.ts";
import { useColor } from "../theme.ts";

// Delay before clearing completed tasks from the list (ms)
const CLEAR_COMPLETED_DELAY = 3000;

// Tree drawing characters
const TREE_BRANCH = "├─";
const TREE_LAST = "└─";
const TREE_VERTICAL = "│";
const TREE_INDENT = "⎿";

function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}m`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}k`;
  }
  return `${n}`;
}

function getProgressMessage(progress: TaskProgress | null): string | null {
  if (!progress) return null;

  switch (progress.type) {
    case "starting":
      return "Starting...";
    case "reading_files":
      return `Reading ${progress.files.length} file(s)...`;
    case "thinking":
      return "Thinking...";
    case "using_tool":
      return `Using ${progress.toolName}...`;
    case "responding":
      return "Responding...";
    case "completed":
      return "Done";
    case "error":
      return `Error: ${progress.error}`;
    case "tokens":
      return null; // Tokens are shown in the main line
    default:
      return null;
  }
}

function TaskTreeItem({
  task,
  isLast,
  isExpanded,
}: {
  task: Task;
  isLast: boolean;
  isExpanded: boolean;
}) {
  const themeColor = useColor();
  const connector = isLast ? TREE_LAST : TREE_BRANCH;
  const progressMessage = getProgressMessage(task.progress);

  // Build the main task line
  const toolUses =
    task.toolUseCount > 0
      ? ` · ${task.toolUseCount} tool use${task.toolUseCount !== 1 ? "s" : ""}`
      : "";
  const tokens = task.tokenUsage > 0 ? ` · ${formatTokens(task.tokenUsage)} tokens` : "";

  return (
    <Box flexDirection="column">
      {/* Main task line */}
      <Box>
        <Text color="gray">{connector} </Text>
        <Text color={task.status === "running" ? themeColor : "white"}>{task.agentName}</Text>
        <Text dimColor>
          {toolUses}
          {tokens}
        </Text>
      </Box>

      {/* Progress message as sub-item (only when expanded) */}
      {isExpanded && progressMessage && (
        <Box>
          <Text color="gray">
            {isLast ? "   " : `${TREE_VERTICAL}  `} {TREE_INDENT}{" "}
          </Text>
          <Text dimColor>{progressMessage}</Text>
        </Box>
      )}

      {/* Show recent file activity for reading_files progress */}
      {isExpanded && task.progress?.type === "reading_files" && task.progress.files.length > 0 && (
        <Box>
          <Text color="gray">
            {isLast ? "   " : `${TREE_VERTICAL}  `} {TREE_INDENT}{" "}
          </Text>
          <Text dimColor>Read: {task.progress.files[task.progress.files.length - 1]}</Text>
        </Box>
      )}

      {/* Show tool name for using_tool progress */}
      {isExpanded && task.progress?.type === "using_tool" && (
        <Box>
          <Text color="gray">
            {isLast ? "   " : `${TREE_VERTICAL}  `} {TREE_INDENT}{" "}
          </Text>
          <Text dimColor>Tool: {task.progress.toolName}</Text>
        </Box>
      )}
    </Box>
  );
}

export function TaskList() {
  const themeColor = useColor();
  const { tasks, showTaskList, closeTaskList } = useTaskStoreShallow(state => ({
    tasks: state.tasks,
    showTaskList: state.showTaskList,
    closeTaskList: state.closeTaskList,
  }));

  const taskList = Array.from(tasks.values()).sort((a, b) => b.startTime - a.startTime);
  const activeTasks = taskList.filter(t => t.status === "pending" || t.status === "running");
  const runningCount = activeTasks.length;

  // Keyboard shortcuts - only handle Esc/q to close (Ctrl+T is handled globally in app.tsx)
  useInput((input, key) => {
    if (!showTaskList) return;

    // When open, handle close shortcuts
    if (key.escape || input === "q") {
      closeTaskList();
    }
  });

  // Auto-clear completed/failed/cancelled tasks after a delay
  React.useEffect(() => {
    const completedTasks = taskList.filter(
      t => t.status === "completed" || t.status === "failed" || t.status === "cancelled",
    );

    if (completedTasks.length === 0) return;

    const timer = setTimeout(() => {
      useTaskStore.getState().clearCompletedTasks();
    }, CLEAR_COMPLETED_DELAY);

    return () => clearTimeout(timer);
  }, [taskList]);

  // Hide completely when there are no tasks (regardless of expand/collapse state)
  if (taskList.length === 0) {
    return null;
  }

  // Compact view when closed - show summary line
  if (!showTaskList) {
    return (
      <Box>
        <Text color={runningCount > 0 ? themeColor : "gray"}>
          Running {runningCount} agent{runningCount !== 1 ? "s" : ""}…
        </Text>
        <Text dimColor> (Ctrl+T to expand)</Text>
      </Box>
    );
  }

  // Expanded tree view
  return (
    <Box flexDirection="column" marginBottom={2}>
      {/* Header */}
      <Box>
        <Text color={runningCount > 0 ? themeColor : "gray"}>
          Running {runningCount} agent{runningCount !== 1 ? "s" : ""}…
        </Text>
        <Text dimColor> (Ctrl+T to collapse)</Text>
      </Box>

      {/* Tree */}
      <Box flexDirection="column">
        {taskList.map((task, index) => (
          <TaskTreeItem
            key={task.id}
            task={task}
            isLast={index === taskList.length - 1}
            isExpanded={showTaskList}
          />
        ))}
      </Box>
    </Box>
  );
}

// Compact task indicator for status bar (kept for backward compatibility)
export function TaskStatusIndicator() {
  const { activeCount, totalCount } = useTaskStoreShallow(state => {
    const tasks = Array.from(state.tasks.values());
    return {
      activeCount: tasks.filter(t => t.status === "pending" || t.status === "running").length,
      totalCount: tasks.length,
    };
  });

  const themeColor = useColor();

  if (totalCount === 0) {
    return null;
  }

  return (
    <Box>
      <Text color={activeCount > 0 ? themeColor : "gray"}>
        [{activeCount > 0 ? "▶" : "✓"} {activeCount}/{totalCount} task{totalCount !== 1 ? "s" : ""}]
      </Text>
    </Box>
  );
}

// Task notifications display
export function TaskNotifications() {
  const { notifications, clearNotifications } = useTaskStoreShallow(state => ({
    notifications: state.notifications,
    clearNotifications: state.clearNotifications,
  }));

  const themeColor = useColor();

  // Auto-clear notifications after 5 seconds
  React.useEffect(() => {
    if (notifications.length === 0) return;

    const timer = setTimeout(() => {
      clearNotifications();
    }, 5000);

    return () => clearTimeout(timer);
  }, [notifications, clearNotifications]);

  if (notifications.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginY={1}>
      {notifications.map((notif, index) => (
        <Box key={index}>
          <Text
            color={notif.type === "completed" ? "green" : notif.type === "failed" ? "red" : "gray"}
          >
            {notif.type === "completed" ? "✓" : notif.type === "failed" ? "✗" : "○"} {notif.message}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
