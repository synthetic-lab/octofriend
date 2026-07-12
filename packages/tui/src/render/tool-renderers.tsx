import { Box, Text } from "ink";
import type { ReactElement } from "react";
import type { MalformedToolRequest } from "../runtime/models/ir/main.ts";
import type { ToolCall as ToolCallRequest } from "../runtime/tools/main.ts";
import { useTerminalThemeColor } from "../theme/branding.tsx";
import { DiffRenderer, FileRenderer } from "./code.tsx";
import { normalizeRenderedLineBreaks } from "./lines.ts";
import { type LspToolParsedSchema, LspToolRenderer } from "./lsp.tsx";
import {
	type ParsedToolCallArguments,
	type ParsedToolCallSchema,
	parsedItemFor,
} from "./tool-types.ts";

export function ToolMessageRenderer({
	item,
}: {
	item: ToolCallRequest | MalformedToolRequest;
}) {
	if (item.type === "malformed-tool-request") return null;
	const Renderer = TOOL_RENDERERS[item.name];
	return Renderer === undefined ? null : (
		<Renderer item={parsedItemFor(item)} />
	);
}

function renderedToolValue(
	value: string | number | boolean | null | undefined,
): string {
	if (value == null) return "";
	return typeof value === "string"
		? normalizeRenderedLineBreaks(value)
		: `${value}`;
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
			<Text color="gray">{name}:</Text>{" "}
			<Text color={color}>{renderedToolValue(arg)}</Text>
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
			<Text color="gray">
				Octo read the {renderedToolValue(item.arguments.skillName)} skill
			</Text>
		</Box>
	);
}

export function FetchToolRenderer({ item }: { item: ParsedToolCallSchema }) {
	const themeColor = useTerminalThemeColor();
	return (
		<Box>
			<Text color="gray">{item.name}: </Text>
			<Text color={themeColor}>{renderedToolValue(item.arguments.url)}</Text>
		</Box>
	);
}

export function ShellToolRenderer({ item }: { item: ParsedToolCallSchema }) {
	const themeColor = useTerminalThemeColor();
	return (
		<Box flexDirection="column">
			<Box>
				<Text color="gray">{item.name}: </Text>
				<Text color={themeColor}>{renderedToolValue(item.arguments.cmd)}</Text>
			</Box>
			<Text color="gray">
				timeout: {renderedToolValue(item.arguments.timeout)}
			</Text>
		</Box>
	);
}

export function ReadToolRenderer({ item }: { item: ParsedToolCallSchema }) {
	const themeColor = useTerminalThemeColor();
	return (
		<Box>
			<Text color="gray">{item.name}: </Text>
			<Text color={themeColor}>
				{renderedToolValue(item.arguments.filePath)}
			</Text>
		</Box>
	);
}

export function ListToolRenderer({ item }: { item: ParsedToolCallSchema }) {
	const themeColor = useTerminalThemeColor();
	return (
		<Box>
			<Text color="gray">{item.name}: </Text>
			<Text color={themeColor}>
				{renderedToolValue(item?.arguments?.dirPath || process.cwd())}
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
				<Text color={themeColor}>
					{renderedToolValue(item.arguments.filePath)}
				</Text>
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
				<Text color={themeColor}>
					{renderedToolValue(item.arguments.filePath)}
				</Text>
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
	const argumentsText = JSON.stringify(item.arguments.arguments);
	return (
		<Box flexDirection="column">
			<Box>
				<Text color="gray">{item.name}: </Text>
				<Text color={themeColor}>
					Server: {renderedToolValue(item.arguments.server)}, Tool:{" "}
					{renderedToolValue(item.arguments.tool)}
				</Text>
			</Box>
			<Text color="gray">Arguments: {argumentsText}</Text>
		</Box>
	);
}

type ToolRenderer = (props: {
	item: ParsedToolCallSchema;
}) => ReactElement | null;

function LspToolMessageRenderer({ item }: { item: ParsedToolCallSchema }) {
	return <LspToolRenderer item={item as unknown as LspToolParsedSchema} />;
}

const TOOL_RENDERERS: Partial<Record<string, ToolRenderer>> = {
	read: ReadToolRenderer,
	list: ListToolRenderer,
	shell: ShellToolRenderer,
	edit: EditToolRenderer,
	create: CreateToolRenderer,
	mcp: McpToolRenderer,
	fetch: FetchToolRenderer,
	rewrite: RewriteToolRenderer,
	skill: SkillToolRenderer,
	"web-search": WebSearchToolRenderer,
	glob: GlobRenderer,
	grep: GrepRenderer,
	"lsp-definition": LspToolMessageRenderer,
	"lsp-references": LspToolMessageRenderer,
	"lsp-hover": LspToolMessageRenderer,
	"lsp-diagnostics": LspToolMessageRenderer,
	"lsp-document-symbol": LspToolMessageRenderer,
	"lsp-implementation": LspToolMessageRenderer,
	"lsp-incoming-calls": LspToolMessageRenderer,
	"lsp-outgoing-calls": LspToolMessageRenderer,
};
