import { ToolResult } from "./tools/common.ts";
import { ToolCallRequest, AnthropicAssistantData } from "./ir/llm-ir.ts";

export type SequenceIdTagged<T> = T & {
  id: bigint;
};

export type ToolCallItem = SequenceIdTagged<{
  type: "tool";
  tool: ToolCallRequest;
}>;

export type ToolOutputItem = SequenceIdTagged<{
  type: "tool-output";
  result: ToolResult;
  toolCallId: string;
}>;

export type ToolMalformedItem = SequenceIdTagged<{
  type: "tool-malformed";
  error: string;
  original: Partial<{
    id: string;
    function: Partial<{
      name: string;
      arguments: string;
    }>;
  }>;
  toolCallId: string;
}>;

export type ToolFailedItem = SequenceIdTagged<{
  type: "tool-failed";
  error: string;
  toolCallId: string;
  toolName: string;
}>;

export type ToolRejectItem = SequenceIdTagged<{
  type: "tool-reject";
  toolCallId: string;
}>;

export type FileOutdatedItem = SequenceIdTagged<{
  type: "file-outdated";
  toolCallId: string;
  error: string;
}>;

export type FileUnreadableItem = SequenceIdTagged<{
  type: "file-unreadable";
  path: string;
  toolCallId: string;
  error: string;
}>;

export type AssistantItem = SequenceIdTagged<{
  type: "assistant";
  content: string;
  reasoningContent?: string;
  openai?: {
    encryptedReasoningContent?: string | null;
    reasoningId?: string;
  };
  anthropic?: AnthropicAssistantData;
  tokenUsage: number; // Delta token usage from previous message
  outputTokens: number;
}>;

export type UserItem = SequenceIdTagged<{
  type: "user";
  content: string;
}>;

export type RequestFailed = SequenceIdTagged<{
  type: "request-failed";
}>;

export type CompactionFailed = SequenceIdTagged<{
  type: "compaction-failed";
}>;

export type Notification = SequenceIdTagged<{
  type: "notification";
  content: string;
}>;

export type CompactionCheckpointItem = SequenceIdTagged<{
  type: "compaction-checkpoint";
  summary: string;
}>;

export type HistoryItem =
  | UserItem
  | AssistantItem
  | ToolCallItem
  | ToolOutputItem
  | ToolFailedItem
  | ToolMalformedItem
  | ToolRejectItem
  | FileOutdatedItem
  | FileUnreadableItem
  | RequestFailed
  | CompactionFailed
  | Notification
  | CompactionCheckpointItem;

let monotonicGuid = 0n;
export function sequenceId() {
  return monotonicGuid++;
}
