import { Box, type DOMElement, measureElement, Text } from "ink";
import type React from "react";
import { useContext, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { displayLog } from "../app/runtime_logging.ts";
import { useAppStore } from "../app/state/store.ts";
import type { InflightResponseType } from "../app/state/types.ts";
import { LINE_SPLIT_REGEX } from "../app/text_processing.ts";
import type { HistoryItem } from "../internal/conversation-history/main.ts";
import type { Content } from "../internal/llm-ir/main.ts";
import type { OctoIR } from "../internal/octo-agent-ir/main.ts";
import { IsScrollableContext, ScrollView } from "../layout/scroll.tsx";
import { useTerminalSize } from "../layout/viewport.tsx";
import { Octo, useTerminalThemeColor } from "../theme/branding.tsx";
import { ContentRenderer, ToolOutputContentRenderer } from "./content.tsx";
import { Markdown } from "./markdown.tsx";
import { ToolMessageRenderer } from "./tools.tsx";
import type { AssistantDisplayItem } from "./types.ts";

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
	const { modeData } = useAppStore(
		useShallow((state) => ({
			modeData: state.modeData,
		})),
	);

	if (item.type === "inflight-response") {
		return renderInflightResponse(item, modeData.mode === "compacting");
	}

	if (item.type === "notification") {
		return (
			<Box marginLeft={1}>
				<Text color="gray">{item.content}</Text>
			</Box>
		);
	}

	if (item.type === "llm-ir") {
		return renderLlmIR(item.ir, modeData.mode === "compacting");
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
			<AssistantMessageRenderer item={item} />
		</Box>
	);
}

export function renderLlmIR(
	item: OctoIR,
	isCompacting: boolean,
): React.ReactNode {
	switch (item.role) {
		case "assistant":
			return renderAssistantItem(item, isCompacting);
		case "tool-parse-error":
			return renderToolParseError(item);
		case "tool-validation-error":
			return renderToolValidationError(item);
		case "tool-runtime-error":
			return renderToolRuntimeError(item);
		case "tool-reject":
			return renderToolReject(item);
		case "tool-skip-output":
			return null;
		case "checkpoint":
			return <CompactionSummaryRenderer content={item.content} />;
		case "tool-output":
			return renderToolOutput(item);
		case "file-read":
			return renderFileRead(item);
		case "file-mutate":
			return renderFileMutate(item);
		case "user":
			return renderUserItem(item);
		default:
			return null;
	}
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
type UserItem = Extract<OctoIR, { role: "user" }>;

function renderAssistantItem(item: AssistantItem, isCompacting: boolean) {
	return (
		<Box marginBottom={1}>
			{isCompacting ? (
				<CompactionRenderer item={item} />
			) : (
				<AssistantMessageRenderer item={item} />
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
			<ToolOutputContentRenderer
				content={[
					{ type: "text", content: item.content },
					...(item.image
						? [{ type: "image" as const, image: item.image }]
						: []),
				]}
			/>
		</Box>
	);
}

function renderFileMutate(item: FileMutateItem) {
	return (
		<Box flexDirection="column" marginBottom={1}>
			<ToolMessageRenderer item={item.toolCall} />
			<ToolOutputContentRenderer
				content={[{ type: "text", content: item.content }]}
			/>
		</Box>
	);
}

function renderUserItem(item: UserItem) {
	const textParts = item.content.filter(
		(
			part: Content["content"][number],
		): part is Extract<Content["content"][number], { type: "text" }> =>
			part.type === "text",
	);
	const imageParts = item.content.filter(
		(part: Content["content"][number]) => part.type === "image",
	);
	const contentLines = textParts.flatMap(
		(part: Extract<Content["content"][number], { type: "text" }>) =>
			part.content.split(LINE_SPLIT_REGEX),
	);

	return (
		<Box flexDirection="column" marginY={1}>
			<Box flexDirection="row">
				<Box marginRight={1}>
					<Text color="white">▶</Text>
				</Box>
				{imageParts.length > 0 && (
					<Box marginRight={1}>
						<Text inverse={true}>
							⟦ 📎 {imageParts.length} image{imageParts.length > 1 ? "s" : ""}{" "}
							attached ⟧
						</Text>
					</Box>
				)}
				<Box flexDirection="column">
					{contentLines.map((line: string, i: number) => (
						<Box key={i}>
							<Text>{line}</Text>
						</Box>
					))}
				</Box>
			</Box>
		</Box>
	);
}

const SUMMARY_OPEN_TAG_REGEX = /^<summary>/;
const SUMMARY_CLOSE_TAG_REGEX = /<\/summary>$/;

export function stripCompactionSummaryTags(content: string): string {
	return content
		.replace(SUMMARY_OPEN_TAG_REGEX, "")
		.replace(SUMMARY_CLOSE_TAG_REGEX, "");
}

export function CompactionSummaryRenderer({
	content,
}: {
	content: Content["content"];
}) {
	const color = useTerminalThemeColor();
	const displayContent = content.map((part) => {
		if (part.type === "image") return part;
		return {
			...part,
			content: stripCompactionSummaryTags(part.content),
		};
	});

	return (
		<Box flexDirection="column" marginY={1}>
			<Text color="gray">History compacted! Summary: </Text>
			<ContentRenderer content={displayContent} textColor="gray" />
			<Text color={color}>Summary complete!</Text>
		</Box>
	);
}

const OCTO_MARGIN = 1;
const OCTO_PADDING = 2;
function OctoMessageRenderer({ children }: { children?: React.ReactNode }) {
	return (
		<Box>
			<Box
				marginRight={OCTO_MARGIN}
				width={OCTO_PADDING}
				flexShrink={0}
				flexGrow={0}
			>
				<Octo />
			</Box>
			{children}
		</Box>
	);
}

function CompactionRenderer({ item }: { item: AssistantDisplayItem }) {
	const terminalSize = useTerminalSize();
	const scrollHeight = Math.max(1, Math.min(10, terminalSize.height - 10));
	return (
		<OctoMessageRenderer>
			<MaybeScrollView height={scrollHeight}>
				<Text color="gray">{item.content}</Text>
			</MaybeScrollView>
		</OctoMessageRenderer>
	);
}

function AssistantMessageRenderer({ item }: { item: AssistantDisplayItem }) {
	const terminalSize = useTerminalSize();
	const thoughts = item.reasoningContent
		? item.reasoningContent.trim()
		: item.reasoningContent;
	const content = item.content.trim();

	let reservedSpace = 6;
	const scrollViewHeight = Math.max(1, terminalSize.height - reservedSpace - 1);

	const showThoughts = thoughts && thoughts !== "";
	if (showThoughts) reservedSpace += 2;
	return (
		<OctoMessageRenderer>
			<MaybeScrollView height={scrollViewHeight}>
				{showThoughts && <ThoughtBox thoughts={thoughts} />}
				<Markdown markdown={content} />
			</MaybeScrollView>
		</OctoMessageRenderer>
	);
}

function MaybeScrollView({
	children,
	height,
}: {
	height: number;
	children?: React.ReactNode;
}) {
	const { modeData } = useAppStore(
		useShallow((state) => ({
			modeData: state.modeData,
		})),
	);
	const isStreamingContent =
		modeData.mode === "responding" || modeData.mode === "compacting";
	return (
		<Box flexDirection="column" flexGrow={1}>
			{isStreamingContent ? (
				<ScrollView height={height}>{children}</ScrollView>
			) : (
				<Box flexDirection="column">{children}</Box>
			)}
		</Box>
	);
}

const MAX_THOUGHTBOX_HEIGHT = 8;
const MAX_THOUGHTBOX_WIDTH = 80;
const THOUGHTBOX_MARGIN = 4;
function ThoughtBox({ thoughts }: { thoughts: string }) {
	const thoughtsRef = useRef<DOMElement | null>(null);
	const [thoughtsHeight, setThoughtsHeight] = useState(0);
	const terminalSize = useTerminalSize();
	const thoughtsOverflow = thoughtsHeight - (MAX_THOUGHTBOX_HEIGHT - 2);
	const isScrollable = useContext(IsScrollableContext);

	useEffect(() => {
		if (thoughtsRef.current) {
			const { height } = measureElement(thoughtsRef.current);
			setThoughtsHeight(height);
		}
	}, [thoughts]);

	const enforceMaxHeight = thoughtsOverflow > 0 && !isScrollable;
	const octoSpace = OCTO_MARGIN + OCTO_PADDING + 1;
	const scrollBorderWidth = 2;
	const contentMaxWidth =
		terminalSize.width - THOUGHTBOX_MARGIN - octoSpace - scrollBorderWidth;
	const maxWidth = Math.min(contentMaxWidth, MAX_THOUGHTBOX_WIDTH);

	return (
		<Box flexDirection="column">
			<Box
				flexGrow={0}
				flexShrink={1}
				height={enforceMaxHeight ? MAX_THOUGHTBOX_HEIGHT : undefined}
				width={maxWidth}
				overflowY={enforceMaxHeight ? "hidden" : undefined}
				flexDirection="column"
				borderColor="gray"
				borderStyle="round"
			>
				<Box
					ref={thoughtsRef}
					flexGrow={0}
					flexShrink={0}
					flexDirection="column"
					marginTop={enforceMaxHeight ? -1 * Math.max(0, thoughtsOverflow) : 0}
				>
					<Text color="gray">{thoughts}</Text>
				</Box>
			</Box>
		</Box>
	);
}
