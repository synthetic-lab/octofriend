import path from "path";
import {
  HistoryItem,
  ToolCallItems,
  ToolOutputItem,
  ToolMalformedItem,
  ToolValidationErrorItem,
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

import { contentToText } from "./content.ts";
import type { OctoIR, TrajectoryOutputIR } from "./octo-ir.ts";
import type { AssistantMessage } from "../libocto/llm-ir.ts";
import type toolMap from "../tools/tool-defs/index.ts";

type OctoAssistantMessage = AssistantMessage<typeof toolMap>;

// Filter out only relevant history items to the LLM IR
type LoweredHistory =
  | ToolCallItems
  | ToolOutputItem
  | ToolMalformedItem
  | ToolValidationErrorItem
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
  if (output.role === "tool-parse-error") {
    return [
      {
        type: "tool-parse-error",
        id: sequenceId(),
        malformedRequest: output.malformedRequest,
      },
    ];
  }

  if (output.role === "tool-validation-error") {
    return [
      {
        type: "tool-validation-error",
        id: sequenceId(),
        toolCall: output.toolCall,
        error: output.error,
        aborted: !!output.aborted,
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
  if (output.role === "checkpoint") {
    return [
      {
        type: "checkpoint",
        id: sequenceId(),
        summary: contentToText(output.content),
      },
    ];
  }

  if (output.role === "file-read") {
    return [
      {
        type: "tool-output",
        id: sequenceId(),
        result: {
          content: output.content,
          image: output.image,
        },
        toolCall: output.toolCall,
      },
    ];
  }

  if (output.role === "file-mutate") {
    return [
      {
        type: "tool-output",
        id: sequenceId(),
        result: {
          content: output.content,
        },
        toolCall: output.toolCall,
      },
    ];
  }

  if (output.role === "tool-skip-output") {
    return [
      {
        id: sequenceId(),
        type: "tool-skip-output",
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

export function toLlmIR(history: HistoryItem[]): Array<OctoIR> {
  const output: OctoIR[] = [];
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
function collapseToIR(prev: OctoIR | null, item: LoweredHistory): [OctoIR | null, OctoIR | null] {
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
  if (item.type === "tool-parse-error") {
    return [
      null,
      {
        role: "tool-parse-error",
        malformedRequest: item.malformedRequest,
      },
    ];
  }

  if (item.type === "tool-validation-error") {
    return [
      null,
      {
        role: "tool-validation-error",
        toolCall: item.toolCall,
        error: item.error,
        aborted: item.aborted,
      },
    ];
  }

  if (item.type === "tool-reject") {
    return [
      null,
      {
        role: "tool-skip-output",
        toolCall: item.toolCall,
        reason: "Tool call rejected by user.",
      },
    ];
  }

  if (item.type === "tool-failed") {
    return [
      null,
      {
        role: "tool-runtime-error",
        error: item.error,
        toolCall: item.toolCall,
      },
    ];
  }

  if (item.type === "tool-skip-output") {
    return [
      null,
      {
        role: "tool-skip-output",
        toolCall: item.toolCall,
        reason: item.reason,
      },
    ];
  }

  if (item.type === "tool-output") {
    switch (item.toolCall.name) {
      case "append":
        return [
          null,
          {
            role: "file-mutate",
            content: item.result.content,
            toolCall: item.toolCall,
            path: path.resolve(item.toolCall.parsed.filePath),
          },
        ];
      case "prepend":
        return [
          null,
          {
            role: "file-mutate",
            content: item.result.content,
            toolCall: item.toolCall,
            path: path.resolve(item.toolCall.parsed.filePath),
          },
        ];
      case "edit":
        return [
          null,
          {
            role: "file-mutate",
            content: item.result.content,
            toolCall: item.toolCall,
            path: path.resolve(item.toolCall.parsed.filePath),
          },
        ];
      case "rewrite":
        return [
          null,
          {
            role: "file-mutate",
            content: item.result.content,
            toolCall: item.toolCall,
            path: path.resolve(item.toolCall.parsed.filePath),
          },
        ];
      case "create":
        return [
          null,
          {
            role: "file-mutate",
            content: item.result.content,
            toolCall: item.toolCall,
            path: path.resolve(item.toolCall.parsed.filePath),
          },
        ];
      case "read":
        return [
          null,
          {
            role: "file-read",
            content: item.result.content,
            toolCall: item.toolCall,
            path: path.resolve(item.toolCall.parsed.filePath),
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
      case "lsp-definition":
      case "lsp-references":
      case "lsp-hover":
      case "lsp-diagnostics":
      case "lsp-document-symbol":
      case "lsp-implementation":
      case "lsp-incoming-calls":
      case "lsp-outgoing-calls":
        return [
          null,
          {
            role: "tool-output",
            content: [{ type: "text", content: item.result.content }],
            toolCall: item.toolCall,
          },
        ];
    }
    return [
      null,
      {
        role: "tool-output",
        content: [{ type: "text", content: item.result.content }],
        toolCall: item.toolCall,
      },
    ];
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

  if (item.type === "checkpoint") {
    return [
      prev,
      {
        role: "checkpoint",
        content: [{ type: "text", content: item.summary }],
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
      content: [
        { type: "text", content: item.content },
        ...(item.images ?? []).map(image => ({ type: "image" as const, image })),
      ],
    },
  ];
}

function assertPrevAssistant<T extends HistoryItem["type"]>(
  type: T,
  _: HistoryItem & { type: T },
  prev: OctoIR | null,
  callback: (prev: OctoAssistantMessage) => [OctoIR | null, OctoIR | null],
): [OctoIR | null, OctoIR | null] {
  if (prev == null) return [null, null];
  if (prev.role === "assistant") return callback(prev);
  throw new Error(
    `Impossible tool ordering: no prev assistant response for ${type}. Prev role: ${prev.role}`,
  );
}
