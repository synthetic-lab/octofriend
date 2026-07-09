import { Text } from "ink";
import type { ReactElement } from "react";
import { useCwd } from "../app/workspace_context.tsx";
import type { ToolCall as ToolCallRequest } from "../internal/tool-orchestration/main.ts";
import { normalizeRenderedLineBreaks } from "./line_splitting.ts";
import { type ParsedToolCallSchema, parsedItemFor } from "./tool-types.ts";

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
	cwd,
	kind,
}: {
	cwd: string;
	kind: "reads" | "changes";
}) {
	return (
		<Text>
			<Text> file {kind} in </Text>
			<Text bold={true}>{renderedWhitelistValue(cwd)}</Text>
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
}: {
	toolCallRequest: ToolCallRequest;
}) {
	const cwd = useCwd();
	const staticDescription = STATIC_WHITELIST_DESCRIPTIONS[toolCallRequest.name];
	if (staticDescription !== undefined) return staticDescription;
	if (toolCallRequest.name === "shell") {
		return <ShellWhitelistDescription toolCallRequest={toolCallRequest} />;
	}
	if (toolCallRequest.name === "list" || toolCallRequest.name === "read") {
		return <ToolScopeDescription cwd={cwd} kind="reads" />;
	}
	if (
		toolCallRequest.name === "edit" ||
		toolCallRequest.name === "create" ||
		toolCallRequest.name === "rewrite"
	) {
		return <ToolScopeDescription cwd={cwd} kind="changes" />;
	}
	if (toolCallRequest.name === "mcp") {
		return <McpWhitelistDescription toolCallRequest={toolCallRequest} />;
	}
	if (toolCallRequest.name === "skill") {
		return <SkillWhitelistDescription toolCallRequest={toolCallRequest} />;
	}
	return <Text> this tool in this session.</Text>;
}
