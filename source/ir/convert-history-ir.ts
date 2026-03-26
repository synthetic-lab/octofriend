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
    const [newPrev, transformed] = collapseToIR(output, item);
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

// Find the most recent assistant message by searching backward through output
function findPrevAssistant(output: LlmIR[]): AssistantMessage | null {
  for (let i = output.length - 1; i >= 0; i--) {
    const item = output[i];
    if (item.role === "assistant") return item;
  }
  return null;
}

// Given previous LLM messages, a history item, and the latest
// edits map, returns a tuple of:
//
// 1. What the prev message should be overwritten with
// 2. The history item transformed to an LLM message
//
// The prev message overwrite doesn't need to be a new object: you can just return `prev` for that
// position if you don't intend to overwrite anything. However, the transformed history-to-LLM
// message must be a new object: do not simply return the history item, or it could be modified by
// future calls.
function collapseToIR(output: LlmIR[], item: LoweredHistory): [LlmIR | null, LlmIR | null] {
  const prev = output.length > 0 ? output[output.length - 1] : null;

  if (item.type === "tool") {
    return assertPrevAssistant("tool", item, output, prev => {
      // Collapse the tool call into the previous assistant message
      // If prev already has toolCalls, append to it; otherwise create new array
      const existingToolCalls = prev.toolCalls || [];
      return [
        {
          role: "assistant",
          content: prev.content || "",
          toolCalls: [...existingToolCalls, item.tool],
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
    return assertPrevAssistant(
      "tool-malformed",
      item,
      output,
      (prev): [LlmIR | null, LlmIR | null] => {
        // Collapse the malformed tool call into the previous assistant message, and structure the
        // response
        const toolName = item.original.function?.name || "unknown";
        return [
          {
            role: "assistant",
            content: prev.content || "",
            toolCalls: [
              {
                type: "function",
                function: {
                  name: toolName as any,
                  arguments: item.original.function?.arguments || "{}",
                },
                toolCallId: item.toolCallId,
              },
            ],
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
            arguments: item.original.function?.arguments || "{}",
            error: item.error,
          },
        ];
      },
    );
  }

  if (item.type === "tool-reject") {
    return assertPrevAssistantToolCall("tool-reject", item, output, item.toolCallId, prev => {
      const toolCall = findToolById(prev.toolCalls, item.toolCallId);
      return [
        prev,
        {
          role: "tool-reject",
          toolCall,
        },
      ];
    });
  }

  if (item.type === "tool-failed") {
    return assertPrevAssistantToolCall("tool-failed", item, output, item.toolCallId, prev => {
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
    return assertPrevAssistantToolCall("tool-output", item, output, item.toolCallId, prev => {
      const toolCall = findToolById(prev.toolCalls, item.toolCallId);
      switch (toolCall.function.name) {
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
              toolCall,
              path: path.resolve(toolCall.function.arguments.filePath),
            },
          ];
        case "read":
          return [
            prev,
            {
              role: "file-read",
              content: item.result.content,
              toolCall,
              path: path.resolve(toolCall.function.arguments.filePath),
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
          return [
            prev,
            {
              role: "tool-output",
              content: item.result.content,
              toolCall,
            },
          ];
      }
    });
  }

  if (item.type === "file-outdated") {
    return assertPrevAssistantToolCall("file-outdated", item, output, item.toolCallId, prev => {
      const toolCall = findToolById(prev.toolCalls, item.toolCallId);
      return [
        prev,
        {
          role: "file-outdated",
          toolCall,
          error: item.error,
        },
      ];
    });
  }

  if (item.type === "file-unreadable") {
    return assertPrevAssistantToolCall("file-unreadable", item, output, item.toolCallId, prev => {
      const toolCall = findToolById(prev.toolCalls, item.toolCallId);
      return [
        prev,
        {
          role: "file-unreadable",
          toolCall,
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
      images: item.images,
    },
  ];
}

// Find a tool call by ID in the toolCalls array
function findToolById(toolCalls: ToolCallRequest[], toolCallId: string): ToolCallRequest {
  const toolCall = toolCalls.find(tc => tc.toolCallId === toolCallId);
  if (!toolCall) {
    throw new Error(`Tool call ${toolCallId} not found in assistant message`);
  }
  return toolCall;
}

function assertPrevAssistant<T extends HistoryItem["type"]>(
  type: T,
  _: HistoryItem & { type: T },
  output: LlmIR[],
  callback: (prev: AssistantMessage) => [LlmIR | null, LlmIR | null],
): [LlmIR | null, LlmIR | null] {
  const prev = output.length > 0 ? output[output.length - 1] : null;
  if (prev == null) return [null, null];
  if (prev.role === "assistant") return callback(prev);
  
  // Search backward for the most recent assistant message
  // This handles cases where tool errors are interleaved with tool outputs
  const prevAssistant = findPrevAssistant(output);
  if (prevAssistant) return callback(prevAssistant);
  
  throw new Error(
    `Impossible tool ordering: no prev assistant response for ${type}. Prev role: ${prev.role}`,
  );
}

function assertPrevAssistantToolCall<T extends HistoryItem["type"]>(
  type: T,
  item: HistoryItem & { type: T },
  output: LlmIR[],
  toolCallId: string,
  callback: (
    prev: AssistantMessage & { toolCalls: ToolCallRequest[] },
  ) => [LlmIR | null, LlmIR | null],
): [LlmIR | null, LlmIR | null] {
  return assertPrevAssistant(type, item, output, assistant => {
    const { toolCalls } = assistant;
    if (toolCalls && toolCalls.length > 0) {
      // Verify the specific toolCallId exists in this assistant's tool calls
      if (!toolCalls.find(tc => tc.toolCallId === toolCallId)) {
        throw new Error(
          `Tool call ${toolCallId} not found in assistant message for ${type}`
        );
      }
      return callback({ ...assistant, toolCalls });
    }
    throw new Error(
      `Impossible tool ordering: no prev assistant tool call for ${type}. Prev role: ${assistant.role}`,
    );
  });
}
