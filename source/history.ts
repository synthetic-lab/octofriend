import { t } from "structural";
import { ToolCallSchema } from "./tools/index.ts";

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
	content: string,
  toolCallId: string,
}>;

export type ToolMalformedItem = SequenceIdTagged<{
  type: "tool-malformed",
  error: string,
  original: Partial<{
    id: string,
    function: {
      name: string,
      arguments: string,
    },
  }>,
  toolCallId: string,
}>;

export type ToolFailedItem = SequenceIdTagged<{
  type: "tool-failed",
  error: string,
  toolCallId: string,
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

export type AssistantItem = SequenceIdTagged<{
  type: "assistant";
  content: string;
  reasoningContent?: string;
  tokenUsage: number; // Delta token usage from previous message
}>;

export type UserItem = SequenceIdTagged<{
  type: "user",
  content: string,
}>;

export type RequestFailed = SequenceIdTagged<{
  type: "request-failed",
}>;

export type ModelSwitched = SequenceIdTagged<{
  type: "model-switched",
  model: string,
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
                        | ModelSwitched
                        ;

let monotonicGuid = 0n;
export function sequenceId() {
  return monotonicGuid++;
}
