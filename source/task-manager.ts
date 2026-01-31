import { create } from "zustand";
import { useShallow } from "zustand/shallow";

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type TaskProgress =
  | { type: "starting"; message: string }
  | { type: "reading_files"; files: string[] }
  | { type: "thinking"; message: string }
  | { type: "using_tool"; toolName: string; increment?: boolean }
  | { type: "tokens"; count: number }
  | { type: "responding"; contentPreview: string }
  | { type: "completed" }
  | { type: "error"; error: string };

export type Task = {
  id: string;
  agentName: string;
  prompt: string;
  status: TaskStatus;
  progress: TaskProgress | null;
  result: string | null;
  error: string | null;
  startTime: number;
  endTime: number | null;
  files: string[];
  toolUseCount: number;
  tokenUsage: number;
};

export type TaskNotification = {
  type: "completed" | "failed" | "cancelled";
  task: Task;
  message: string;
};

export type TaskState = {
  tasks: Map<string, Task>;
  selectedTaskId: string | null;
  showTaskList: boolean;
  notifications: TaskNotification[];

  // Actions
  createTask: (agentName: string, prompt: string, files: string[]) => string;
  updateTaskProgress: (taskId: string, progress: TaskProgress) => void;
  completeTask: (taskId: string, result: string) => void;
  failTask: (taskId: string, error: string) => void;
  cancelTask: (taskId: string) => void;
  cancelAllRunningTasks: () => void;
  deleteTask: (taskId: string) => void;
  selectTask: (taskId: string | null) => void;
  toggleTaskList: () => void;
  openTaskList: () => void;
  closeTaskList: () => void;
  clearCompletedTasks: () => void;
  addNotification: (notification: TaskNotification) => void;
  clearNotifications: () => void;
  dismissNotification: (index: number) => void;

  // Getters
  getActiveTasks: () => Task[];
  getCompletedTasks: () => Task[];
  getTaskById: (taskId: string) => Task | undefined;
};

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: new Map(),
  selectedTaskId: null,
  showTaskList: false,
  notifications: [],

  createTask: (agentName, prompt, files) => {
    // Use random ID to avoid collisions with parallel task creation
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const task: Task = {
      id,
      agentName,
      prompt,
      status: "pending",
      progress: { type: "starting", message: `Initializing ${agentName}...` },
      result: null,
      error: null,
      startTime: Date.now(),
      endTime: null,
      files,
      toolUseCount: 0,
      tokenUsage: 0,
    };

    set(state => {
      const newTasks = new Map(state.tasks);
      newTasks.set(id, task);
      return { tasks: newTasks };
    });

    return id;
  },

  updateTaskProgress: (taskId, progress) => {
    set(state => {
      const task = state.tasks.get(taskId);
      if (!task) return state;

      const newTasks = new Map(state.tasks);
      const updatedTask: Task = {
        ...task,
        status: task.status === "pending" ? "running" : task.status,
        progress,
        toolUseCount:
          progress.type === "using_tool" && progress.increment
            ? task.toolUseCount + 1
            : task.toolUseCount,
        tokenUsage: progress.type === "tokens" ? task.tokenUsage + progress.count : task.tokenUsage,
      };
      newTasks.set(taskId, updatedTask);
      return { tasks: newTasks };
    });
  },

  completeTask: (taskId, result) => {
    set(state => {
      const task = state.tasks.get(taskId);
      if (!task) return state;

      const newTasks = new Map(state.tasks);
      const updatedTask: Task = {
        ...task,
        status: "completed",
        progress: { type: "completed" },
        result,
        endTime: Date.now(),
        toolUseCount: task.toolUseCount,
        tokenUsage: task.tokenUsage,
      };
      newTasks.set(taskId, updatedTask);

      // Add notification
      const notification: TaskNotification = {
        type: "completed",
        task: updatedTask,
        message: `✅ ${task.agentName} completed`,
      };

      return {
        tasks: newTasks,
        notifications: [...state.notifications.slice(-2), notification], // Keep last 3
      };
    });
  },

  failTask: (taskId, error) => {
    set(state => {
      const task = state.tasks.get(taskId);
      if (!task) return state;

      const newTasks = new Map(state.tasks);
      const updatedTask: Task = {
        ...task,
        status: "failed",
        progress: { type: "error", error },
        error,
        endTime: Date.now(),
        toolUseCount: task.toolUseCount,
        tokenUsage: task.tokenUsage,
      };
      newTasks.set(taskId, updatedTask);

      // Add notification
      const notification: TaskNotification = {
        type: "failed",
        task: updatedTask,
        message: `❌ ${task.agentName} failed: ${error.slice(0, 100)}`,
      };

      return {
        tasks: newTasks,
        notifications: [...state.notifications.slice(-2), notification],
      };
    });
  },

  cancelTask: taskId => {
    set(state => {
      const task = state.tasks.get(taskId);
      if (!task) return state;

      const newTasks = new Map(state.tasks);
      newTasks.set(taskId, {
        ...task,
        status: "cancelled",
        endTime: Date.now(),
      });
      return { tasks: newTasks };
    });
  },

  cancelAllRunningTasks: () => {
    set(state => {
      const newTasks = new Map(state.tasks);
      for (const [id, task] of state.tasks) {
        if (task.status === "pending" || task.status === "running") {
          newTasks.set(id, {
            ...task,
            status: "cancelled",
            endTime: Date.now(),
          });
        }
      }
      return { tasks: newTasks };
    });
  },

  deleteTask: taskId => {
    set(state => {
      const newTasks = new Map(state.tasks);
      newTasks.delete(taskId);
      return {
        tasks: newTasks,
        selectedTaskId: state.selectedTaskId === taskId ? null : state.selectedTaskId,
      };
    });
  },

  selectTask: taskId => {
    set({ selectedTaskId: taskId });
  },

  toggleTaskList: () => {
    set(state => ({ showTaskList: !state.showTaskList }));
  },

  openTaskList: () => {
    set({ showTaskList: true });
  },

  closeTaskList: () => {
    set({ showTaskList: false, selectedTaskId: null });
  },

  clearCompletedTasks: () => {
    set(state => {
      const newTasks = new Map();
      for (const [id, task] of state.tasks) {
        if (task.status !== "completed" && task.status !== "cancelled") {
          newTasks.set(id, task);
        }
      }
      return { tasks: newTasks, selectedTaskId: null };
    });
  },

  addNotification: notification => {
    set(state => ({
      notifications: [...state.notifications.slice(-2), notification],
    }));
  },

  clearNotifications: () => {
    set({ notifications: [] });
  },

  dismissNotification: index => {
    set(state => ({
      notifications: state.notifications.filter((_, i) => i !== index),
    }));
  },

  getActiveTasks: () => {
    const tasks = get().tasks;
    return Array.from(tasks.values()).filter(t => t.status === "pending" || t.status === "running");
  },

  getCompletedTasks: () => {
    const tasks = get().tasks;
    return Array.from(tasks.values()).filter(
      t => t.status === "completed" || t.status === "failed" || t.status === "cancelled",
    );
  },

  getTaskById: taskId => {
    return get().tasks.get(taskId);
  },
}));

// Hook for using task store with shallow comparison
export function useTaskStoreShallow<T>(selector: (state: TaskState) => T): T {
  return useTaskStore(useShallow(selector));
}
