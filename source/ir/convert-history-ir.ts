import path from "path";
import {
  HistoryItem,
  ToolCallItem,
  ToolOutputItem,
  ToolMalformedItem,
  ToolFailedItem,
  ToolRejectItem,
  FileOutdatedItem,
  FileUnreadableItem,
  AssistantItem,
  UserItem,
  CompactionCheckpointItem,
  sequenceId,
} from "../history.ts";

import { AssistantMessage, LlmIR, ToolCallRequest, TrajectoryOutputIR } from "./llm-ir.ts";

// Filter out only relevant history items to the LLM IR
type LoweredHistory =
  | ToolCallItem
  | ToolOutputItem
  | ToolMalformedItem
  | ToolFailedItem
  | ToolRejectItem
  | FileOutdatedItem
  | FileUnreadableItem
  | AssistantItem
  | UserItem
  | CompactionCheckpointItem;

// Decompile LLM output IR to History items
export function outputToHistory(output: TrajectoryOutputIR[]): HistoryItem[] {
  let history: HistoryItem[] = [];
  for (const ir of output) {
    history = history.concat(singleOutputDecompile(ir));
  }
  return history;
}

function singleOutputDecompile(output: TrajectoryOutputIR): HistoryItem[] {
  if (output.role === "tool-malformed") {
    return [
      {
        type: "tool-malformed",
        id: sequenceId(),
        error: output.error,
        toolCallId: output.toolCallId,
        original: {
          id: output.toolCallId,
          function: {
            name: output.toolName,
            arguments: output.arguments,
          },
        },
      },
    ];
  }
  if (output.role === "tool-error") {
    return [
      {
        type: "tool-failed",
        id: sequenceId(),
        error: output.error,
        toolCallId: output.toolCallId,
        toolName: output.toolName,
      },
    ];
  }
  if (output.role === "file-outdated") {
    return [
      {
        type: "file-outdated",
        id: sequenceId(),
        toolCallId: output.toolCall.toolCallId,
        error: output.error,
      },
    ];
  }
  if (output.role === "file-unreadable") {
    return [
      {
        type: "file-unreadable",
        path: output.path,
        id: sequenceId(),
        toolCallId: output.toolCall.toolCallId,
        error: output.error,
      },
    ];
  }
  if (output.role === "compaction-checkpoint") {
    return [
      {
        type: "compaction-checkpoint",
        id: sequenceId(),
        summary: output.summary,
      },
    ];
  }

  const history: HistoryItem[] = [];
  const reasoningContent: { reasoningContent?: string } = {};
  if (output.reasoningContent) reasoningContent.reasoningContent = output.reasoningContent;

  history.push({
    type: "assistant",
    id: sequenceId(),
    content: output.content,
    ...reasoningContent,
    openai: output.openai,
    anthropic: output.anthropic,
    tokenUsage: output.tokenUsage,
    outputTokens: output.outputTokens,
  });

  // Handle single tool call
  if (output.toolCall) {
    history.push({
      type: "tool",
      id: sequenceId(),
      tool: {
        type: output.toolCall.type,
        function: output.toolCall.function,
        toolCallId: output.toolCall.toolCallId,
      },
    });
  }

  // Handle parallel tool calls
  if (output.toolCalls && output.toolCalls.length > 0) {
    for (const toolCall of output.toolCalls) {
      history.push({
        type: "tool",
        id: sequenceId(),
        tool: {
          type: toolCall.type,
          function: toolCall.function,
          toolCallId: toolCall.toolCallId,
        },
      });
    }
  }

  return history;
}

export function toLlmIR(history: HistoryItem[]): Array<LlmIR> {
  const output: LlmIR[] = [];
  const lowered: LoweredHistory[] = [];

  // Filter out irrelevant high-level history items, keeping only the LLM-relevant ones
  for (const item of history) {
    const loweredItem = lowerItem(item);
    if (loweredItem) lowered.push(loweredItem);
  }

  // Transform
  for (let i = 0; i < lowered.length; i++) {
    const item = lowered[i];
    const prev = output.length > 0 ? output[output.length - 1] : null;
    const [newPrev, transformed] = collapseToIR(prev, item, output);
    if (newPrev) output[output.length - 1] = newPrev;
    if (transformed) output.push(transformed);
  }

  return output;
}

function lowerItem(item: HistoryItem): LoweredHistory | null {
  if (
    item.type !== "request-failed" &&
    item.type !== "compaction-failed" &&
    item.type !== "notification"
  )
    return item;
  return null;
}

// Given a previous LLM message (if one exists) in the conversation, a history item, and the latest
// edits map, returns a tuple of:
//
// 1. What the prev message should be overwritten with
// 2. The history item transformed to an LLM message
//
// The prev message overwrite doesn't need to be a new object: you can just return `prev` for that
// position if you don't intend to overwrite anything. However, the transformed history-to-LLM
// message must be a new object: do not simply return the history item, or it could be modified by
// future calls.
function collapseToIR(
  prev: LlmIR | null,
  item: LoweredHistory,
  output: LlmIR[],
): [LlmIR | null, LlmIR | null] {
  if (item.type === "tool") {
    return assertPrevAssistant("tool", item, prev, prev => {
      // Collapse the tool call into the previous assistant message
      // Handle parallel tool calls by accumulating into toolCalls array
      const updatedAssistant: typeof prev = {
        role: "assistant",
        content: prev.content || "",
        openai: prev.openai,
        anthropic: prev.anthropic,
        reasoningContent: prev.reasoningContent,
        tokenUsage: prev.tokenUsage,
        outputTokens: prev.outputTokens,
      };

      if (prev.toolCalls && prev.toolCalls.length > 0) {
        // Already have multiple tool calls, append to array
        updatedAssistant.toolCalls = [...prev.toolCalls, item.tool];
      } else if (prev.toolCall) {
        // Have a single tool call, convert to array
        updatedAssistant.toolCalls = [prev.toolCall, item.tool];
      } else {
        // First tool call
        updatedAssistant.toolCall = item.tool;
      }

      return [updatedAssistant, null];
    });
  }
  if (item.type === "tool-malformed") {
    return assertPrevAssistant(
      "tool-malformed",
      item,
      prev,
      (prev): [LlmIR | null, LlmIR | null] => {
        // Collapse the malformed tool call into the previous assistant message, and structure the
        // response
        const toolName = item.original.function?.name || "unknown";
        return [
          {
            role: "assistant",
            content: prev.content || "",
            toolCall: {
              type: "function",
              function: {
                name: toolName as any,
                arguments: item.original.function?.arguments || "{}",
              },
              toolCallId: item.toolCallId,
            },
            openai: prev.openai,
            anthropic: prev.anthropic,
            reasoningContent: prev.reasoningContent,
            tokenUsage: prev.tokenUsage,
            outputTokens: prev.outputTokens,
          } satisfies LlmIR,
          {
            role: "tool-malformed",
            toolCallId: item.toolCallId,
            toolName,
            arguments: item.original.function?.arguments || "",
            error: item.error,
          },
        ];
      },
    );
  }

  if (item.type === "tool-reject") {
    return assertPrevAssistantToolCall("tool-reject", item, prev, output, prev => {
      return [
        prev,
        {
          role: "tool-reject",
          toolCall: prev.toolCall,
        },
      ];
    });
  }

  if (item.type === "tool-failed") {
    return assertPrevAssistantToolCall("tool-failed", item, prev, output, prev => {
      return [
        prev,
        {
          role: "tool-error",
          error: item.error,
          toolCallId: item.toolCallId,
          toolName: item.toolName,
        },
      ];
    });
  }

  if (item.type === "tool-output") {
    return assertPrevAssistantToolCall("tool-output", item, prev, output, prev => {
      switch (prev.toolCall.function.name) {
        case "append":
        case "prepend":
        case "rewrite":
        case "edit":
        case "create":
          return [
            prev,
            {
              role: "file-mutate",
              content: item.result.content,
              toolCall: prev.toolCall,
              path: path.resolve(prev.toolCall.function.arguments.filePath),
            },
          ];
        case "read":
          return [
            prev,
            {
              role: "file-read",
              content: item.result.content,
              toolCall: prev.toolCall,
              path: path.resolve(prev.toolCall.function.arguments.filePath),
            },
          ];
        case "skill":
        case "fetch":
        case "list":
        case "shell":
        case "mcp":
        case "web-search":
        case "task":
          return [
            prev,
            {
              role: "tool-output",
              content: item.result.content,
              toolCall: prev.toolCall,
            },
          ];
      }
    });
  }

  if (item.type === "file-outdated") {
    return assertPrevAssistantToolCall("file-outdated", item, prev, output, prev => {
      return [
        prev,
        {
          role: "file-outdated",
          toolCall: prev.toolCall,
          error: item.error,
        },
      ];
    });
  }

  if (item.type === "file-unreadable") {
    return assertPrevAssistantToolCall("file-unreadable", item, prev, output, prev => {
      return [
        prev,
        {
          role: "file-unreadable",
          toolCall: prev.toolCall,
          path: item.path,
          error: item.error,
        },
      ];
    });
  }

  if (item.type === "compaction-checkpoint") {
    return [
      prev,
      {
        role: "compaction-checkpoint",
        summary: item.summary,
      },
    ];
  }

  if (item.type === "assistant") {
    return [
      prev,
      {
        role: "assistant",
        content: item.content || " ",
        reasoningContent: item.reasoningContent,
        openai: item.openai,
        anthropic: item.anthropic,
        tokenUsage: item.tokenUsage,
        outputTokens: item.outputTokens,
      },
    ];
  }

  // Type assertion we've handled all cases other than user
  const _: "user" = item.type;

  return [
    prev,
    {
      role: "user",
      content: item.content,
    },
  ];
}

function assertPrevAssistant<T extends HistoryItem["type"]>(
  type: T,
  _: HistoryItem & { type: T },
  prev: LlmIR | null,
  callback: (prev: AssistantMessage) => [LlmIR | null, LlmIR | null],
): [LlmIR | null, LlmIR | null] {
  if (prev == null) return [null, null];
  if (prev.role === "assistant") return callback(prev);
  throw new Error(
    `Impossible tool ordering: no prev assistant response for ${type}. Prev role: ${prev.role}`,
  );
}

function assertPrevAssistantToolCall<T extends HistoryItem["type"]>(
  type: T,
  item: HistoryItem & { type: T },
  prev: LlmIR | null,
  output: LlmIR[],
  callback: (
    prev: AssistantMessage & { toolCall: ToolCallRequest },
  ) => [LlmIR | null, LlmIR | null],
): [LlmIR | null, LlmIR | null] {
  // If prev is not an assistant, look back through output to find the assistant
  // This handles parallel tool execution where multiple tool outputs are consecutive
  let effectivePrev = prev;
  if (effectivePrev && effectivePrev.role !== "assistant") {
    // Look backwards through output to find the most recent assistant
    for (let i = output.length - 1; i >= 0; i--) {
      const item = output[i];
      if (item.role === "assistant") {
        effectivePrev = item;
        break;
      }
    }
  }

  return assertPrevAssistant(type, item, effectivePrev, effectivePrev => {
    const { toolCall, toolCalls } = effectivePrev;
    // Handle single tool call
    if (toolCall) return callback({ ...effectivePrev, toolCall });
    // Handle parallel tool calls - find the matching one by toolCallId
    if (toolCalls && toolCalls.length > 0) {
      // Get the toolCallId from the item based on its type
      let itemToolCallId: string | undefined;
      if ("toolCallId" in item) {
        itemToolCallId = item.toolCallId;
      }
      if (itemToolCallId) {
        const matchingToolCall = toolCalls.find(tc => tc.toolCallId === itemToolCallId);
        if (matchingToolCall) {
          return callback({ ...effectivePrev, toolCall: matchingToolCall });
        }
      }
      // If no specific match found, use the first one (fallback for malformed items)
      return callback({ ...effectivePrev, toolCall: toolCalls[0] });
    }
    throw new Error(
      `Impossible tool ordering: no prev assistant tool call for ${type}. Prev role: ${effectivePrev.role}`,
    );
  });
}
