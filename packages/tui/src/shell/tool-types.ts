import type React from "react";
import type { ToolCall as ToolCallRequest } from "../runtime/tools/main.ts";
import type { RunArgs } from "./state/types.ts";

export type TerminalToolRequestsProps = {
	toolReqs: ToolCallRequest[];
} & RunArgs;

export type TerminalToolRequestProps = {
	toolReq: ToolCallRequest;
	onDone: () => void;
	preflighted?: boolean;
} & RunArgs;

export type FinishToolRequestsProps = {
	runAgent: (args: RunArgs) => Promise<void>;
} & RunArgs;

export type ToolRequestSelectItem = {
	label: string;
	value: "yes" | "yes-whitelist" | "no";
	whitelistAllowDescription?: React.ReactNode;
};

export const TOOL_REQUEST_PREPARE_ERROR =
	"Failed to prepare tool request. Try again.";

export const TOOL_REQUEST_LOADING_STRINGS = [
	"Waiting",
	"Watching",
	"Smiling",
	"Hungering",
	"Splashing",
	"Writhing",
];
