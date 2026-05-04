import { ToolResult } from "./tools/common.ts";
import { ToolCallRequest, AnthropicAssistantData, MalformedRequest } from "./ir/llm-ir.ts";
import { ImageInfo } from "./utils/image-utils.ts";

export type SequenceIdTagged<T> = T & {
  id: bigint;
};

export type ToolCallItems = SequenceIdTagged<{
  type: "tool-calls";
  tools: Array<ToolCallRequest | MalformedRequest>;
}>;

export type ToolOutputItem = SequenceIdTagged<{
  type: "tool-output";
  result: ToolResult;
  toolCall: ToolCallRequest;
}>;

export type ToolMalformedItem = SequenceIdTagged<{
  type: "tool-malformed";
  malformedRequest: MalformedRequest;
}>;

export type ToolValidationErrorItem = SequenceIdTagged<{
  type: "tool-validation-error";
  error: string;
  toolCall: ToolCallRequest;
}>;

export type ToolFailedItem = SequenceIdTagged<{
  type: "tool-failed";
  error: string;
  toolCall: ToolCallRequest;
}>;

export type ToolRejectItem = SequenceIdTagged<{
  type: "tool-reject";
  toolCall: ToolCallRequest;
}>;

export type ToolSkipItem = SequenceIdTagged<{
  type: "tool-skip";
  toolCall: ToolCallRequest;
  reason: string;
}>;

export type FileOutdatedItem = SequenceIdTagged<{
  type: "file-outdated";
  toolCall: ToolCallRequest;
  error: string;
}>;

export type FileUnreadableItem = SequenceIdTagged<{
  type: "file-unreadable";
  path: string;
  toolCall: ToolCallRequest;
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
  images?: ImageInfo[];
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
  | ToolCallItems
  | ToolOutputItem
  | ToolFailedItem
  | ToolMalformedItem
  | ToolValidationErrorItem
  | ToolRejectItem
  | ToolSkipItem
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
