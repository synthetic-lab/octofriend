import { ToolResult } from "./tools/common.ts";
import type { AnthropicAssistantData, MalformedToolRequest } from "./libocto/llm-ir.ts";
import type { ToolCall } from "./libocto/tool-def.ts";
import type toolMap from "./tools/tool-defs/index.ts";
import { ImageInfo } from "./utils/image-utils.ts";

type ToolCallRequest = ToolCall<typeof toolMap>;

export type SequenceIdTagged<T> = T & {
  id: bigint;
};

export type ToolCallItems = SequenceIdTagged<{
  type: "tool-calls";
  tools: Array<ToolCallRequest | MalformedToolRequest>;
}>;

export type ToolOutputItem = SequenceIdTagged<{
  type: "tool-output";
  result: ToolResult;
  toolCall: ToolCallRequest;
}>;

export type ToolMalformedItem = SequenceIdTagged<{
  type: "tool-parse-error";
  malformedRequest: MalformedToolRequest;
}>;

export type ToolValidationErrorItem = SequenceIdTagged<{
  type: "tool-validation-error";
  error: string;
  toolCall: ToolCallRequest;
  aborted: boolean;
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
  type: "tool-skip-output";
  toolCall: ToolCallRequest;
  reason: string;
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
  type: "checkpoint";
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
  | RequestFailed
  | CompactionFailed
  | Notification
  | CompactionCheckpointItem;

let monotonicGuid = 0n;
export function sequenceId() {
  return monotonicGuid++;
}
