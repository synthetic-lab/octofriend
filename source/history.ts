import { t } from "structural";
import { ToolCallSchema } from "./tools/index.ts";

export const ToolCallRequestSchema = t.subtype({
	type: t.value("function"),
	tool: ToolCallSchema,
});

export type ToolCallItem = {
	type: "tool",
	tool: t.GetType<typeof ToolCallRequestSchema>,
};

export type ToolOutputItem = {
	type: "tool-output",
	content: string,
};

export type ToolErrorItem = {
  type: "tool-error",
  error: string,
  original: string,
};

export type ToolRejectItem = {
  type: "tool-reject",
};

export type FileOutdatedItem = {
  type: "file-outdated",
  updatedFile: string,
};

export type FileEditItem = {
  type: "file-edit",
  path: string,  // Absolute path
  content: string, // Latest content
  sequence: number, // Monotonically increasing sequence number to track latest edit
};

export type AssistantItem = {
  type: "assistant";
  content: string;
  tokenUsage: number; // Delta token usage from previous message
};

export type UserItem = {
  type: "user",
  content: string,
};

type SequenceIdTagged<T> = T & {
};

export type HistoryItem = SequenceIdTagged<
  UserItem
  | AssistantItem
  | ToolCallItem
  | ToolOutputItem
  | ToolErrorItem
  | ToolRejectItem
  | FileOutdatedItem
  | FileEditItem
>;
