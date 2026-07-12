import { Text } from "ink";
import type { ReactElement } from "react";
import type { ToolCall as ToolCallRequest } from "../runtime/tools/main";
import { useCwd } from "../shell/workspace-context";
import { normalizeRenderedLineBreaks } from "./lines";
import { type ParsedToolCallSchema, parsedItemFor } from "./tool-types";

function renderedWhitelistValue(value: string | undefined): string {
	return typeof value === "string" ? normalizeRenderedLineBreaks(value) : "";
}

const STATIC_WHITELIST_DESCRIPTIONS: Readonly<Record<string, ReactElement>> = {
	glob: <Text> local glob searches in this session.</Text>,
	grep: <Text> local grep searches in this session.</Text>,
	fetch: <Text> fetches from the web during this session.</Text>,
	"web-search": <Text> Web Searches during this session.</Text>,
	"lsp-definition": <Text> LSP queries during this session.</Text>,
	"lsp-references": <Text> LSP queries during this session.</Text>,
	"lsp-hover": <Text> LSP queries during this session.</Text>,
	"lsp-diagnostics": <Text> LSP queries during this session.</Text>,
	"lsp-document-symbol": <Text> LSP queries during this session.</Text>,
	"lsp-implementation": <Text> LSP queries during this session.</Text>,
	"lsp-incoming-calls": <Text> LSP queries during this session.</Text>,
	"lsp-outgoing-calls": <Text> LSP queries during this session.</Text>,
};

function ToolScopeDescription({
	directory,
	kind,
}: {
	directory: string;
	kind: "reads" | "changes";
}) {
	return (
		<Text>
			<Text> file {kind} in </Text>
			<Text bold={true}>{renderedWhitelistValue(directory)}</Text>
		</Text>
	);
}

function ShellWhitelistDescription({
	toolCallRequest,
}: {
	toolCallRequest: ToolCallRequest;
}) {
	const item = parsedItemFor<ParsedToolCallSchema>(toolCallRequest);
	return (
		<Text>
			<Text> commands starting with </Text>
			<Text bold={true}>{renderedWhitelistValue(item.arguments.cmd)}</Text>
		</Text>
	);
}

function McpWhitelistDescription({
	toolCallRequest,
}: {
	toolCallRequest: ToolCallRequest;
}) {
	const item = parsedItemFor<ParsedToolCallSchema>(toolCallRequest);
	return (
		<Text>
			<Text>
				{" "}
				MCP tools with Server:{" "}
				<Text bold={true}>{renderedWhitelistValue(item.arguments.server)}</Text>
				{" using Tool: "}
				<Text bold={true}>{renderedWhitelistValue(item.arguments.tool)}</Text>
			</Text>
		</Text>
	);
}

function SkillWhitelistDescription({
	toolCallRequest,
}: {
	toolCallRequest: ToolCallRequest;
}) {
	const item = parsedItemFor<ParsedToolCallSchema>(toolCallRequest);
	return (
		<Text>
			{" "}
			{renderedWhitelistValue(item.arguments.skillName)} skill executions
		</Text>
	);
}

export function WhitelistAllowDescription({
	toolCallRequest,
	whitelistKey,
}: {
	toolCallRequest: ToolCallRequest;
	whitelistKey?: string;
}) {
	const cwd = useCwd();
	const filesystemScope = whitelistKey?.split(":", 2)[1] ?? cwd;
	const readTools = new Set([
		"read",
		"list",
		"glob",
		"grep",
		"lsp-definition",
		"lsp-references",
		"lsp-hover",
		"lsp-diagnostics",
		"lsp-document-symbol",
		"lsp-implementation",
		"lsp-incoming-calls",
		"lsp-outgoing-calls",
	]);
	if (readTools.has(toolCallRequest.name)) {
		return <ToolScopeDescription directory={filesystemScope} kind="reads" />;
	}
	const staticDescription = STATIC_WHITELIST_DESCRIPTIONS[toolCallRequest.name];
	if (staticDescription !== undefined) return staticDescription;
	if (toolCallRequest.name === "shell") {
		return <ShellWhitelistDescription toolCallRequest={toolCallRequest} />;
	}
	if (
		toolCallRequest.name === "edit" ||
		toolCallRequest.name === "create" ||
		toolCallRequest.name === "rewrite"
	) {
		return <ToolScopeDescription directory={filesystemScope} kind="changes" />;
	}
	if (toolCallRequest.name === "mcp") {
		return <McpWhitelistDescription toolCallRequest={toolCallRequest} />;
	}
	if (toolCallRequest.name === "skill") {
		return <SkillWhitelistDescription toolCallRequest={toolCallRequest} />;
	}
	return <Text> this tool in this session.</Text>;
}
