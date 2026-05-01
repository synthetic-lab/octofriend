import path from "path";
import {
  HistoryItem,
  ToolCallItems,
  ToolOutputItem,
  ToolMalformedItem,
  ToolFailedItem,
  ToolRejectItem,
  ToolSkipItem,
  FileOutdatedItem,
  FileUnreadableItem,
  AssistantItem,
  UserItem,
  CompactionCheckpointItem,
  sequenceId,
} from "../history.ts";

import { AssistantMessage, LlmIR, TrajectoryOutputIR } from "./llm-ir.ts";

// Filter out only relevant history items to the LLM IR
type LoweredHistory =
  | ToolCallItems
  | ToolOutputItem
  | ToolMalformedItem
  | ToolFailedItem
  | ToolRejectItem
  | ToolSkipItem
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
        malformedRequest: output.malformedRequest,
      },
    ];
  }
  if (output.role === "tool-error") {
    return [
      {
        type: "tool-failed",
        id: sequenceId(),
        error: output.error,
        toolCall: output.toolCall,
      },
    ];
  }
  if (output.role === "file-outdated") {
    return [
      {
        type: "file-outdated",
        id: sequenceId(),
        toolCall: output.toolCall,
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
        toolCall: output.toolCall,
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

  if (output.role === "tool-skip") {
    return [
      {
        id: sequenceId(),
        type: "tool-skip",
        toolCall: output.toolCall,
        reason: output.reason,
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

  if (output.toolCalls && output.toolCalls.length > 0) {
    history.push({
      type: "tool-calls",
      id: sequenceId(),
      tools: output.toolCalls.concat([]),
    });
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
    const [newPrev, transformed] = collapseToIR(prev, item);
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
function collapseToIR(prev: LlmIR | null, item: LoweredHistory): [LlmIR | null, LlmIR | null] {
  if (item.type === "tool-calls") {
    return assertPrevAssistant("tool-calls", item, prev, prev => {
      // Collapse the tool call into the previous assistant message
      return [
        {
          role: "assistant",
          content: prev.content || "",
          toolCalls: [...(prev.toolCalls || []), ...item.tools],
          openai: prev.openai,
          anthropic: prev.anthropic,
          reasoningContent: prev.reasoningContent,
          tokenUsage: prev.tokenUsage,
          outputTokens: prev.outputTokens,
        },
        null,
      ];
    });
  }
  if (item.type === "tool-malformed") {
    return [
      null,
      {
        role: "tool-malformed",
        malformedRequest: item.malformedRequest,
      },
    ];
  }

  if (item.type === "tool-reject") {
    return [
      null,
      {
        role: "tool-reject",
        toolCall: item.toolCall,
      },
    ];
  }

  if (item.type === "tool-failed") {
    return [
      null,
      {
        role: "tool-error",
        error: item.error,
        toolCall: item.toolCall,
      },
    ];
  }

  if (item.type === "tool-skip") {
    return [
      null,
      {
        role: "tool-skip",
        toolCall: item.toolCall,
        reason: item.reason,
      },
    ];
  }

  if (item.type === "tool-output") {
    switch (item.toolCall.call.parsed.name) {
      case "append":
      case "prepend":
      case "edit":
      case "rewrite":
      case "create":
        return [
          null,
          {
            role: "file-mutate",
            content: item.result.content,
            toolCall: item.toolCall,
            path: path.resolve(item.toolCall.call.parsed.arguments.filePath),
          },
        ];
      case "read":
        return [
          null,
          {
            role: "file-read",
            content: item.result.content,
            toolCall: item.toolCall,
            path: path.resolve(item.toolCall.call.parsed.arguments.filePath),
            image: item.result.image,
          },
        ];
      case "skill":
      case "fetch":
      case "list":
      case "shell":
      case "mcp":
      case "web-search":
      case "glob":
      case "grep":
        return [
          null,
          {
            role: "tool-output",
            content: item.result.content,
            toolCall: item.toolCall,
          },
        ];
    }
  }

  if (item.type === "file-outdated") {
    return [
      null,
      {
        role: "file-outdated",
        toolCall: item.toolCall,
        error: item.error,
      },
    ];
  }

  if (item.type === "file-unreadable") {
    return [
      null,
      {
        role: "file-unreadable",
        toolCall: item.toolCall,
        path: item.path,
        error: item.error,
      },
    ];
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
      images: item.images,
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
