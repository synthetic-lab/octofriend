import { t } from "structural";
import { ToolCallSchema } from "./tools/index.ts";

type SequenceIdTagged<T> = T & {
  id: bigint
};

export const ToolCallRequestSchema = t.subtype({
	type: t.value("function"),
	tool: ToolCallSchema,
});

export type ToolCallItem = SequenceIdTagged<{
	type: "tool",
	tool: t.GetType<typeof ToolCallRequestSchema>,
}>;

export type ToolOutputItem = SequenceIdTagged<{
	type: "tool-output",
	content: string,
}>;

export type ToolErrorItem = SequenceIdTagged<{
  type: "tool-error",
  error: string,
  original: string,
}>;

export type ToolRejectItem = SequenceIdTagged<{
  type: "tool-reject",
}>;

export type FileOutdatedItem = SequenceIdTagged<{
  type: "file-outdated",
  updatedFile: string,
}>;

export type FileEditItem = SequenceIdTagged<{
  type: "file-edit",
  path: string,  // Absolute path
  content: string, // Latest content
  sequence: number, // Monotonically increasing sequence number to track latest edit
}>;

export type AssistantItem = SequenceIdTagged<{
  type: "assistant";
  content: string;
  tokenUsage: number; // Delta token usage from previous message
}>;

export type UserItem = SequenceIdTagged<{
  type: "user",
  content: string,
}>;

export type HistoryItem = UserItem
                        | AssistantItem
                        | ToolCallItem
                        | ToolOutputItem
                        | ToolErrorItem
                        | ToolRejectItem
                        | FileOutdatedItem
                        | FileEditItem
                        ;

let monotonicGuid = 0n;
export function sequenceId() {
  return monotonicGuid++;
}
