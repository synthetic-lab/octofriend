import type { FileMutateIR, FileReadIR } from "../file-ir-optimization/main.ts";
import type { LlmIR, ToolCall, ToolContract } from "../llm-ir/main.ts";

export const BuiltInToolContracts = {
	read: { name: "read" },
	edit: { name: "edit" },
	create: { name: "create" },
	rewrite: { name: "rewrite" },
	shell: { name: "shell" },
	list: { name: "list" },
	glob: { name: "glob" },
	grep: { name: "grep" },
	fetch: { name: "fetch" },
	"web-search": { name: "web-search" },
	mcp: { name: "mcp" },
	skill: { name: "skill" },
	"lsp-definition": { name: "lsp-definition" },
	"lsp-implementation": { name: "lsp-implementation" },
	"lsp-references": { name: "lsp-references" },
	"lsp-hover": { name: "lsp-hover" },
	"lsp-incoming-calls": { name: "lsp-incoming-calls" },
	"lsp-outgoing-calls": { name: "lsp-outgoing-calls" },
	"lsp-diagnostics": { name: "lsp-diagnostics" },
	"lsp-document-symbol": { name: "lsp-document-symbol" },
} satisfies Record<string, ToolContract>;

export type OctoToolMap = typeof BuiltInToolContracts;
declare const emptyAgents: unique symbol;
type EmptyAgentDirectory = { readonly [emptyAgents]?: never };
export type OctoAgent = {
	tools: OctoToolMap;
	agents: EmptyAgentDirectory;
};

export const octoAgent: OctoAgent = {
	tools: BuiltInToolContracts,
	agents: {},
};

export type OctoToolCall = ToolCall<typeof BuiltInToolContracts>;

export type OctoToolRejectIR = {
	role: "tool-reject";
	toolCall: OctoToolCall;
	rejectedByUserMessageId: string;
};

export type OctoFileIR = FileReadIR<OctoToolCall> | FileMutateIR<OctoToolCall>;

export type OctoIR = LlmIR<typeof octoAgent> | OctoToolRejectIR | OctoFileIR;
