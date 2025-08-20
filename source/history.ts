import { t } from "structural";
import { ToolCallSchema } from "./tools/index.ts";
import { ToolResult } from "./tools/common.ts";

export type SequenceIdTagged<T> = T & {
  id: bigint
};

export const ToolCallRequestSchema = t.subtype({
	type: t.value("function"),
	function: ToolCallSchema,
  toolCallId: t.str,
});

export type ToolCallRequest = t.GetType<typeof ToolCallRequestSchema>;

export type ToolCallItem = SequenceIdTagged<{
	type: "tool",
	tool: t.GetType<typeof ToolCallRequestSchema>,
}>;

export type ToolOutputItem = SequenceIdTagged<{
	type: "tool-output",
  result: ToolResult,
  toolCallId: string,
}>;

export type ToolMalformedItem = SequenceIdTagged<{
  type: "tool-malformed",
  error: string,
  original: Partial<{
    id: string,
    function: Partial<{
      name: string,
      arguments: string,
    }>,
  }>,
  toolCallId: string,
}>;

export type ToolFailedItem = SequenceIdTagged<{
  type: "tool-failed",
  error: string,
  toolCallId: string,
  toolName: string,
}>;

export type ToolRejectItem = SequenceIdTagged<{
  type: "tool-reject",
  toolCallId: string,
}>;

export type FileOutdatedItem = SequenceIdTagged<{
  type: "file-outdated",
  toolCallId: string,
}>;

export type FileUnreadableItem = SequenceIdTagged<{
  type: "file-unreadable",
  path: string,
  toolCallId: string,
}>;

export type AnthropicAssistantData = {
  thinkingBlocks: Array<{
    type: "thinking",
    thinking: string,
    signature: string,
  } | {
    type: "redacted_thinking",
    data: string,
  }>,
};

export type AssistantItem = SequenceIdTagged<{
  type: "assistant";
  content: string;
  reasoningContent?: string;
  openai?: {
    encryptedReasoningContent?: string | null;
    reasoningId?: string,
  },
  anthropic?: AnthropicAssistantData,
  tokenUsage: number; // Delta token usage from previous message
}>;

export type UserItem = SequenceIdTagged<{
  type: "user",
  content: string,
}>;

export type RequestFailed = SequenceIdTagged<{
  type: "request-failed",
}>;

export type Notification = SequenceIdTagged<{
  type: "notification",
  content: string,
}>;

export type HistoryItem = UserItem
                        | AssistantItem
                        | ToolCallItem
                        | ToolOutputItem
                        | ToolFailedItem
                        | ToolMalformedItem
                        | ToolRejectItem
                        | FileOutdatedItem
                        | FileUnreadableItem
                        | RequestFailed
                        | Notification
                        ;

let monotonicGuid = 0n;
export function sequenceId() {
  return monotonicGuid++;
}
