import path from "path";
import {
  ToolCallRequest,
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
} from "../history.ts";

export type AssistantMessage = {
  role: "assistant",
  content: string,
  reasoningContent?: string | null,
  toolCall?: ToolCallRequest,
};

export type UserMessage = {
  role: "user",
  content: string,
};

export type ToolOutputMessage = {
  role: "tool-output",
  content: string,
  toolCall: ToolCallRequest,
};

export type FileToolMessage = {
  role: "file-tool-output",
  content: string,
  toolCall: ToolCallRequest,
  path: string,
};

export type ToolRejectMessage = {
  role: "tool-reject",
  toolCall: ToolCallRequest,
};

export type ToolErrorMessage = {
  role: "tool-error",
  toolCallId: string,
  error: string,
};

export type FileOutdatedMessage = {
  role: "file-outdated",
  toolCall: ToolCallRequest,
};

export type FileUnreadableMessage = {
  role: "file-unreadable",
  path: string,
  toolCall: ToolCallRequest,
}

export type LlmIR = AssistantMessage
                  | UserMessage
                  | ToolOutputMessage
                  | FileToolMessage
                  | ToolRejectMessage
                  | ToolErrorMessage
                  | FileOutdatedMessage
                  | FileUnreadableMessage
                  | FileToolMessage
                  ;

// Filter out only relevant history items to the LLM IR
type LoweredHistory = ToolCallItem
                    | ToolOutputItem
                    | ToolMalformedItem
                    | ToolFailedItem
                    | ToolRejectItem
                    | FileOutdatedItem
                    | FileUnreadableItem
                    | AssistantItem
                    | UserItem
                    ;

export function toLlmIR(history: HistoryItem[]): Array<LlmIR> {
  const output: LlmIR[] = [];
  const lowered: LoweredHistory[] = [];

  // Filter out irrelevant high-level history items, keeping only the LLM-relevant ones
  for(const item of history) {
    const loweredItem = lowerItem(item);
    if(loweredItem) lowered.push(loweredItem);
  }

  // Transform
  for(let i = 0; i < lowered.length; i++) {
    const item = lowered[i];
    const prev = output.length > 0 ? output[output.length - 1] : null;
    const [ newPrev, transformed ] = collapseToIR(prev, item);
    if(newPrev) output[output.length - 1] = newPrev;
    if(transformed) output.push(transformed);
  }

  return output;
}

function lowerItem(item: HistoryItem): LoweredHistory | null {
  if(item.type !== "request-failed" && item.type !== "notification") return item;
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
): [LlmIR | null, LlmIR | null] {
  if(item.type === "tool") {
    return assertPrevAssistant("tool", item, prev, prev => {
      // Collapse the tool call into the previous assistant message
      return [
        {
          role: "assistant",
          content: prev.content || "",
          toolCall: item.tool,
        },
        null,
      ];
    });
  }
  if(item.type === "tool-malformed") {
    return assertPrevAssistant("tool-malformed", item, prev, prev => {
      const toolCallId = item.original.id || "unknown";
      // Collapse the malformed tool call into the previous assistant message, and structure the
      // response
      return [
        {
          role: "assistant",
          content: prev.content || "",
          tool_calls: [{
            type: "function",
            id: toolCallId,
            function: {
              name: item.original.function?.name || "unknown",
              arguments: item.original.function?.arguments || "{}",
            },
          }],
        },
        {
          role: "tool-error",
          toolCallId,
          error: item.error,
        },
      ];
    });
  }

  if(item.type === "tool-reject") {
    return assertPrevAssistantToolCall("tool-reject", item, prev, prev => {
      return [
        prev,
        {
          role: "tool-reject",
          toolCall: prev.toolCall,
        },
      ];
    });
  }

  if(item.type === "tool-failed") {
    return assertPrevAssistantToolCall("tool-failed", item, prev, prev => {
      return [
        prev,
        {
          role: "tool-error",
          error: item.error,
          toolCallId: prev.toolCall.toolCallId,
        },
      ];
    });
  }

  if(item.type === "tool-output") {
    return assertPrevAssistantToolCall("tool-output", item, prev, prev => {
      switch(prev.toolCall.function.name) {
        case "edit":
        case "create":
        case "read": return [
          prev,
          {
            role: "file-tool-output",
            content: item.content,
            toolCall: prev.toolCall,
            path: path.resolve(prev.toolCall.function.arguments.filePath),
          }
        ];
        case "list":
        case "bash":
        case "mcp":
          return [
            prev,
            {
              role: "tool-output",
              content: item.content,
              toolCall: prev.toolCall,
            }
          ];
      }
    });
  }

  if(item.type === "file-outdated") {
    return assertPrevAssistantToolCall("file-outdated", item, prev, prev => {
      return [
        prev,
        {
          role: "file-outdated",
          toolCall: prev.toolCall,
        }
      ];
    });
  }

  if(item.type === "file-unreadable") {
    return assertPrevAssistantToolCall("file-unreadable", item, prev, prev => {
      return [
        prev,
        {
          role: "file-unreadable",
          toolCall: prev.toolCall,
          path: item.path,
        },
      ];
    });
  }


  if(item.type === "assistant") {
    return [
      prev,
      {
        role: "assistant",
        content: item.content || " ",
        reasoningContent: item.reasoningContent,
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
  callback: (prev: AssistantMessage) => [ LlmIR | null, LlmIR | null ],
): [ LlmIR | null, LlmIR | null ] {
  if(prev == null) return [ null, null ];
  if(prev.role === "assistant") return callback(prev);
  throw new Error(`Impossible tool ordering: no prev assistant response for ${type}`);
}

function assertPrevAssistantToolCall<T extends HistoryItem["type"]>(
  type: T,
  item: HistoryItem & { type: T },
  prev: LlmIR | null,
  callback: (prev: AssistantMessage & { toolCall: ToolCallRequest }) => [ LlmIR | null, LlmIR | null ],
): [ LlmIR | null, LlmIR | null ] {
  return assertPrevAssistant(type, item, prev, prev => {
    const { toolCall } = prev;
    if(toolCall) return callback({ ...prev, toolCall });
    throw new Error(`Impossible tool ordering: no prev assistant tool call for ${type}`);
  });
}
