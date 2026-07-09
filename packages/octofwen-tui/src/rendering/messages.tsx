import { Box, Text } from "ink";
import type React from "react";
import { displayLog } from "../app/runtime_logging.ts";
import { useAppStore } from "../app/state/store.ts";
import type { InflightResponseType, UiState } from "../app/state/types.ts";
import type { HistoryItem } from "../internal/conversation-history/main.ts";
import type { Content } from "../internal/llm-ir/main.ts";
import type { OctoIR } from "../internal/octo-agent-ir/main.ts";
import { useTerminalThemeColor } from "../theme/branding.tsx";
import {
	AssistantMessageRenderer,
	CompactionRenderer,
} from "./assistant-message.tsx";
import {
	appendContentTextLines,
	ImageContentRenderer,
	ToolOutputContentRenderer,
	ToolOutputTextRenderer,
} from "./content.tsx";
import { normalizeRenderedLineBreaks } from "./line_splitting.ts";
import { hasVisibleText } from "./text-visibility.ts";
import { ToolMessageRenderer } from "./tools.tsx";
import { renderUserItem } from "./user-message.tsx";

const selectAppMode = (state: UiState) => state.modeData.mode;

export const MessageDisplay = ({
	item,
}: {
	item: HistoryItem<OctoIR> | InflightResponseType;
}) => {
	return (
		<Box flexDirection="column" paddingRight={4}>
			<MessageDisplayInner item={item} />
		</Box>
	);
};

const MessageDisplayInner = ({
	item,
}: {
	item: HistoryItem<OctoIR> | InflightResponseType;
}) => {
	const mode = useAppStore(selectAppMode);

	if (item.type === "inflight-response") {
		return renderInflightResponse(item, mode === "compacting");
	}

	if (item.type === "notification") {
		return (
			<Box marginLeft={1}>
				<Text color="gray">{normalizeRenderedLineBreaks(item.content)}</Text>
			</Box>
		);
	}

	if (item.type === "llm-ir") {
		return renderLlmIR(item.ir, mode === "compacting");
	}

	if (item.type === "request-failed") {
		return <Text color="red">Request failed.</Text>;
	}

	if (item.type === "compaction-failed") {
		return <Text color="red">Compaction failed.</Text>;
	}

	const _: never = item;
	return null;
};

export function renderInflightResponse(
	item: InflightResponseType,
	isCompacting: boolean,
) {
	if (isCompacting) {
		return (
			<Box marginBottom={1}>
				<CompactionRenderer item={item} />
			</Box>
		);
	}
	return (
		<Box marginBottom={1}>
			<AssistantMessageRenderer item={item} hasVisibleText={hasVisibleText} />
		</Box>
	);
}

export function renderLlmIR(
	item: OctoIR,
	isCompacting: boolean,
): React.ReactNode {
	const renderer = LLM_IR_RENDERERS[item.role] as LlmIrRenderer<OctoIR>;
	return renderer(item, isCompacting);
}

type AssistantItem = Extract<OctoIR, { role: "assistant" }>;
type ToolParseErrorItem = Extract<OctoIR, { role: "tool-parse-error" }>;
type ToolValidationErrorItem = Extract<
	OctoIR,
	{ role: "tool-validation-error" }
>;
type ToolRuntimeErrorItem = Extract<OctoIR, { role: "tool-runtime-error" }>;
type ToolRejectItem = Extract<OctoIR, { role: "tool-reject" }>;
type ToolOutputItem = Extract<OctoIR, { role: "tool-output" }>;
type FileReadItem = Extract<OctoIR, { role: "file-read" }>;
type FileMutateItem = Extract<OctoIR, { role: "file-mutate" }>;
type LlmIrRenderer<T extends OctoIR> = (
	item: T,
	isCompacting: boolean,
) => React.ReactNode;
type LlmIrRenderers = {
	[K in OctoIR["role"]]: LlmIrRenderer<Extract<OctoIR, { role: K }>>;
};

const LLM_IR_RENDERERS: LlmIrRenderers = {
	assistant: renderAssistantItem,
	"tool-parse-error": renderToolParseError,
	"tool-validation-error": renderToolValidationError,
	"tool-runtime-error": renderToolRuntimeError,
	"tool-reject": renderToolReject,
	"tool-skip-output": () => null,
	checkpoint: (item) => <CompactionSummaryRenderer content={item.content} />,
	"tool-output": renderToolOutput,
	"file-read": renderFileRead,
	"file-mutate": renderFileMutate,
	user: renderUserItem,
};

function renderAssistantItem(item: AssistantItem, isCompacting: boolean) {
	return (
		<Box marginBottom={1}>
			{isCompacting ? (
				<CompactionRenderer item={item} />
			) : (
				<AssistantMessageRenderer item={item} hasVisibleText={hasVisibleText} />
			)}
		</Box>
	);
}

function renderToolParseError(item: ToolParseErrorItem) {
	return (
		<Text color="red">
			{displayLog({
				verbose: `Error: ${item.malformedRequest.error}`,
				info: "Malformed tool call. Retrying...",
			})}
		</Text>
	);
}

function renderToolValidationError(item: ToolValidationErrorItem) {
	return (
		<Text color="red">
			{displayLog({
				verbose: `Error: ${item.error}`,
				info: item.aborted
					? "Tool call aborted."
					: "Tool call failed validation checks. Retrying...",
			})}
		</Text>
	);
}

function renderToolRuntimeError(item: ToolRuntimeErrorItem) {
	return (
		<Box flexDirection="column">
			<Box marginLeft={2}>
				<Text color="red">
					{displayLog({
						verbose: `Error: ${item.error}`,
						info: "Tool failed...",
					})}
				</Text>
			</Box>
		</Box>
	);
}

function renderToolReject(item: ToolRejectItem) {
	return (
		<Box flexDirection="column">
			<ToolMessageRenderer item={item.toolCall} />
			<Box marginLeft={2}>
				<Text>Tool rejected; tell Octo what to do instead:</Text>
			</Box>
		</Box>
	);
}

function renderToolOutput(item: ToolOutputItem) {
	return (
		<Box flexDirection="column" marginBottom={1}>
			<ToolMessageRenderer item={item.toolCall} />
			<ToolOutputContentRenderer content={item.content} />
		</Box>
	);
}

function renderFileRead(item: FileReadItem) {
	return (
		<Box flexDirection="column" marginBottom={1}>
			<ToolMessageRenderer item={item.toolCall} />
			<ToolOutputTextRenderer content={item.content} image={item.image} />
		</Box>
	);
}

function renderFileMutate(item: FileMutateItem) {
	return (
		<Box flexDirection="column" marginBottom={1}>
			<ToolMessageRenderer item={item.toolCall} />
			<ToolOutputTextRenderer content={item.content} />
		</Box>
	);
}

export { hasVisibleText };

export function stripCompactionSummaryTags(content: string): string {
	let start = 0;
	let end = content.length;
	if (startsWithSummaryOpenTag(content)) start = "<summary>".length;
	if (endsWithSummaryCloseTag(content, start)) end -= "</summary>".length;
	return start === 0 && end === content.length
		? content
		: content.slice(start, end);
}

function startsWithSummaryOpenTag(content: string): boolean {
	return content.startsWith("<summary>");
}

function endsWithSummaryCloseTag(content: string, start: number): boolean {
	const closeTag = "</summary>";
	if (content.length - start < closeTag.length) return false;
	return content.endsWith(closeTag);
}

export function CompactionSummaryRenderer({
	content,
}: {
	content: Content["content"];
}) {
	const color = useTerminalThemeColor();

	return (
		<Box flexDirection="column" marginY={1}>
			<Text color="gray">History compacted! Summary: </Text>
			<Box flexDirection="column">
				{renderCompactionSummaryContent(content)}
			</Box>
			<Text color={color}>Summary complete!</Text>
		</Box>
	);
}

function renderCompactionSummaryContent(
	content: Content["content"],
): React.ReactNode[] {
	const rows: React.ReactNode[] = [];
	let writeIndex = 0;
	for (let partIndex = 0; partIndex < content.length; partIndex += 1) {
		const part = content[partIndex];
		if (part === undefined) continue;
		if (part.type === "image") {
			rows[writeIndex] = (
				<ImageContentRenderer key={partIndex} image={part.image} />
			);
			writeIndex += 1;
			continue;
		}
		writeIndex = appendContentTextLines(
			rows,
			writeIndex,
			stripCompactionSummaryTags(part.content),
			partIndex,
			"gray",
			false,
		);
	}
	return rows;
}
