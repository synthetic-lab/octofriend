import { Box, Text } from "ink";
import { useCwd } from "../app/workspace_context.tsx";
import type { MalformedToolRequest } from "../internal/llm-ir/main.ts";
import type { ToolCall as ToolCallRequest } from "../internal/tool-orchestration/main.ts";
import { useTerminalThemeColor } from "../theme/branding.tsx";
import { DiffRenderer, FileRenderer } from "./code.tsx";
import { type LspToolParsedSchema, LspToolRenderer } from "./lsp.tsx";

export type ParsedToolCallArguments = {
	server?: string;
	tool?: string;
	filePath?: string;
	cmd?: string;
	skillName?: string;
	path?: string;
	includeName?: string;
	includePath?: string;
	maxDepth?: number;
	pattern?: string;
	caseInsensitive?: boolean;
	context?: number;
	maxResults?: number;
	timeout?: number;
	url?: string;
	dirPath?: string;
	search?: string;
	replace?: string;
	originalFileContents?: string;
	text?: string;
	content?: string;
	arguments?: unknown;
	[key: string]: unknown;
};

export type ParsedToolCallSchema = {
	name: ToolCallRequest["name"];
	arguments: ParsedToolCallArguments;
};

export function parsedToolSchema(
	toolCall: ToolCallRequest,
): ParsedToolCallSchema {
	return {
		name: toolCall.name,
		arguments: toolCall.parsed as ParsedToolCallSchema["arguments"],
	};
}

function parsedItemFor<T>(toolCall: ToolCallRequest): T {
	return parsedToolSchema(toolCall) as unknown as T;
}

export function ToolMessageRenderer({
	item,
}: {
	item: ToolCallRequest | MalformedToolRequest;
}) {
	if (item.type === "malformed-tool-request") {
		return null;
	}
	switch (item.name) {
		case "read":
			return <ReadToolRenderer item={parsedItemFor(item)} />;
		case "list":
			return <ListToolRenderer item={parsedItemFor(item)} />;
		case "shell":
			return <ShellToolRenderer item={parsedItemFor(item)} />;
		case "edit":
			return <EditToolRenderer item={parsedItemFor(item)} />;
		case "create":
			return <CreateToolRenderer item={parsedItemFor(item)} />;
		case "mcp":
			return <McpToolRenderer item={parsedItemFor(item)} />;
		case "fetch":
			return <FetchToolRenderer item={parsedItemFor(item)} />;
		case "rewrite":
			return <RewriteToolRenderer item={parsedItemFor(item)} />;
		case "skill":
			return <SkillToolRenderer item={parsedItemFor(item)} />;
		case "web-search":
			return <WebSearchToolRenderer item={parsedItemFor(item)} />;
		case "glob":
			return <GlobRenderer item={parsedItemFor(item)} />;
		case "grep":
			return <GrepRenderer item={parsedItemFor(item)} />;
		case "lsp-definition":
		case "lsp-references":
		case "lsp-hover":
		case "lsp-diagnostics":
		case "lsp-document-symbol":
		case "lsp-implementation":
		case "lsp-incoming-calls":
		case "lsp-outgoing-calls":
			return (
				<LspToolRenderer item={parsedItemFor<LspToolParsedSchema>(item)} />
			);
		default:
			return null;
	}
}

export function GlobRenderer({ item }: { item: ParsedToolCallSchema }) {
	return (
		<Box flexDirection="column">
			<Text color="gray">Octo searched for files using a glob pattern:</Text>
			<GlobArg name="Path" arg={item.arguments.path} />
			<GlobArg name="Filename pattern" arg={item.arguments.includeName} />
			<GlobArg name="Path pattern" arg={item.arguments.includePath} />
			<GlobArg name="Max depth" arg={item.arguments.maxDepth} />
		</Box>
	);
}

export function GrepRenderer({ item }: { item: ParsedToolCallSchema }) {
	return (
		<Box flexDirection="column">
			<Text color="gray">Octo searched file contents:</Text>
			<GlobArg name="Pattern" arg={item.arguments.pattern} />
			<GlobArg name="Path" arg={item.arguments.path} />
			<GlobArg name="Case insensitive" arg={item.arguments.caseInsensitive} />
			<GlobArg name="Context lines" arg={item.arguments.context} />
			<GlobArg name="Max results" arg={item.arguments.maxResults} />
			<GlobArg name="Timeout" arg={item.arguments.timeout} />
		</Box>
	);
}

function GlobArg({
	name,
	arg,
}: {
	name: string;
	arg: string | number | boolean | undefined;
}) {
	const color = useTerminalThemeColor();
	if (arg == null) return null;
	return (
		<Text>
			<Text color="gray">{name}:</Text> <Text color={color}>{arg}</Text>
		</Text>
	);
}

export function WebSearchToolRenderer(_: { item: ParsedToolCallSchema }) {
	return (
		<Box>
			<Text color="gray">Octo searched the web</Text>
		</Box>
	);
}

export function SkillToolRenderer({ item }: { item: ParsedToolCallSchema }) {
	return (
		<Box>
			<Text color="gray">Octo read the {item.arguments.skillName} skill</Text>
		</Box>
	);
}

export function FetchToolRenderer({ item }: { item: ParsedToolCallSchema }) {
	const themeColor = useTerminalThemeColor();
	return (
		<Box>
			<Text color="gray">{item.name}: </Text>
			<Text color={themeColor}>{item.arguments.url}</Text>
		</Box>
	);
}

export function ShellToolRenderer({ item }: { item: ParsedToolCallSchema }) {
	const themeColor = useTerminalThemeColor();
	return (
		<Box flexDirection="column">
			<Box>
				<Text color="gray">{item.name}: </Text>
				<Text color={themeColor}>{item.arguments.cmd}</Text>
			</Box>
			<Text color="gray">timeout: {item.arguments.timeout}</Text>
		</Box>
	);
}

export function ReadToolRenderer({ item }: { item: ParsedToolCallSchema }) {
	const themeColor = useTerminalThemeColor();
	return (
		<Box>
			<Text color="gray">{item.name}: </Text>
			<Text color={themeColor}>{item.arguments.filePath}</Text>
		</Box>
	);
}

export function ListToolRenderer({ item }: { item: ParsedToolCallSchema }) {
	const themeColor = useTerminalThemeColor();
	return (
		<Box>
			<Text color="gray">{item.name}: </Text>
			<Text color={themeColor}>
				{item?.arguments?.dirPath || process.cwd()}
			</Text>
		</Box>
	);
}

export function EditToolRenderer({ item }: { item: ParsedToolCallSchema }) {
	const themeColor = useTerminalThemeColor();
	return (
		<Box flexDirection="column">
			<Box>
				<Text>Edit: </Text>
				<Text color={themeColor}>{item.arguments.filePath}</Text>
			</Box>
			<DiffEditRenderer
				filePath={item.arguments.filePath ?? ""}
				item={item.arguments}
			/>
		</Box>
	);
}

export function RewriteToolRenderer({ item }: { item: ParsedToolCallSchema }) {
	const { text, filePath, originalFileContents } = item.arguments;

	return (
		<Box flexDirection="column" gap={1}>
			<Text>Octo wants to rewrite the file:</Text>
			<DiffRenderer
				oldText={originalFileContents ?? ""}
				newText={text ?? ""}
				fileContents={originalFileContents ?? ""}
				filepath={filePath ?? ""}
			/>
		</Box>
	);
}

export function DiffEditRenderer({
	item,
	filePath,
}: {
	item: ParsedToolCallArguments;
	filePath: string;
}) {
	return (
		<Box flexDirection="column">
			<Text>Octo wants to make the following changes:</Text>
			<DiffRenderer
				oldText={item.search ?? ""}
				newText={item.replace ?? ""}
				fileContents={item.originalFileContents ?? ""}
				filepath={filePath ?? ""}
			/>
		</Box>
	);
}

export function CreateToolRenderer({ item }: { item: ParsedToolCallSchema }) {
	const themeColor = useTerminalThemeColor();
	return (
		<Box flexDirection="column" gap={1}>
			<Box>
				<Text>Octo wants to create </Text>
				<Text color={themeColor}>{item.arguments.filePath}</Text>
				<Text>:</Text>
			</Box>
			<Box>
				<FileRenderer
					contents={item.arguments.content ?? ""}
					filePath={item.arguments.filePath ?? ""}
				/>
			</Box>
		</Box>
	);
}

export function McpToolRenderer({ item }: { item: ParsedToolCallSchema }) {
	const themeColor = useTerminalThemeColor();
	return (
		<Box flexDirection="column">
			<Box>
				<Text color="gray">{item.name}: </Text>
				<Text color={themeColor}>
					Server: {item.arguments.server}, Tool: {item.arguments.tool}
				</Text>
			</Box>
			<Text color="gray">
				Arguments: {JSON.stringify(item.arguments.arguments)}
			</Text>
		</Box>
	);
}

export function WhitelistAllowDescription({
	toolCallRequest,
}: {
	toolCallRequest: ToolCallRequest;
}) {
	const cwd = useCwd();
	switch (toolCallRequest.name) {
		case "glob":
			return <Text> local glob searches in this session.</Text>;
		case "grep":
			return <Text> local grep searches in this session.</Text>;
		case "shell": {
			const item = parsedItemFor<ParsedToolCallSchema>(toolCallRequest);
			return (
				<Text>
					<Text> commands starting with </Text>
					<Text bold={true}>{item.arguments.cmd}</Text>
				</Text>
			);
		}
		case "fetch": {
			return (
				<Text>
					<Text> fetches from the web during this session.</Text>
				</Text>
			);
		}
		case "web-search": {
			return <Text> Web Searches during this session.</Text>;
		}
		case "list":
		case "read": {
			return (
				<Text>
					<Text> file reads in </Text>
					<Text bold={true}>{cwd}</Text>
				</Text>
			);
		}
		case "edit":
		case "create":
		case "rewrite": {
			return (
				<Text>
					<Text> file changes in </Text>
					<Text bold={true}>{cwd}</Text>
				</Text>
			);
		}
		case "mcp": {
			const item = parsedItemFor<ParsedToolCallSchema>(toolCallRequest);
			return (
				<Text>
					<Text>
						{" "}
						MCP tools with Server:{" "}
						<Text bold={true}>{item.arguments.server}</Text>
						{" using Tool: "}
						<Text bold={true}>{item.arguments.tool}</Text>
					</Text>
				</Text>
			);
		}
		case "skill": {
			const item = parsedItemFor<ParsedToolCallSchema>(toolCallRequest);
			return <Text> {item.arguments.skillName} skill executions</Text>;
		}
		case "lsp-definition":
		case "lsp-references":
		case "lsp-hover":
		case "lsp-diagnostics":
		case "lsp-document-symbol":
		case "lsp-implementation":
		case "lsp-incoming-calls":
		case "lsp-outgoing-calls":
			return <Text> LSP queries during this session.</Text>;
		default:
			return <Text> this tool in this session.</Text>;
	}
}
