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

export type ToolCallItem = SequenceIdTagged<{
	type: "tool",
	tool: t.GetType<typeof ToolCallRequestSchema>,
}>;

export type ToolOutputItem = SequenceIdTagged<{
	type: "tool-output",
	content: string,
  toolCallId: string,
}>;

export type ToolErrorItem = SequenceIdTagged<{
  type: "tool-error",
  error: string,
  original: string,
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

export type HistoryItem = UserItem
                        | AssistantItem
                        | ToolCallItem
                        | ToolOutputItem
                        | ToolErrorItem
                        | ToolRejectItem
                        | FileOutdatedItem
                        | FileUnreadableItem
                        | RequestFailed
                        ;

let monotonicGuid = 0n;
export function sequenceId() {
  return monotonicGuid++;
}
