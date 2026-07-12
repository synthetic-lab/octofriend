import { Box, type DOMElement, measureElement, Text } from "ink";
import type React from "react";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { IsScrollableContext, ScrollView } from "../layout/scroll.tsx";
import { useTerminalSize } from "../layout/viewport.tsx";
import { useAppStore } from "../shell/state/store.ts";
import type { UiState } from "../shell/state/types.ts";
import { Octo } from "../theme/branding.tsx";
import { normalizeRenderedLineBreaks } from "./lines.ts";
import { Markdown } from "./markdown.tsx";
import type { AssistantDisplayItem } from "./types.ts";

const OCTO_MARGIN = 1;
const OCTO_PADDING = 2;

const selectAppMode = (state: UiState) => state.modeData.mode;

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

export function CompactionRenderer({ item }: { item: AssistantDisplayItem }) {
	const terminalSize = useTerminalSize();
	const scrollHeight = Math.max(1, Math.min(10, terminalSize.height - 10));
	const content = useMemo(
		() => normalizeRenderedLineBreaks(item.content),
		[item.content],
	);
	return (
		<OctoMessageRenderer>
			<MaybeScrollView height={scrollHeight}>
				<Text color="gray">{content}</Text>
			</MaybeScrollView>
		</OctoMessageRenderer>
	);
}

export function assistantScrollViewHeight(
	terminalHeight: number,
	showThoughts: boolean,
): number {
	const reservedSpace = showThoughts ? 8 : 6;
	return Math.max(1, terminalHeight - reservedSpace - 1);
}

export function AssistantMessageRenderer({
	item,
	hasVisibleText,
}: {
	item: AssistantDisplayItem;
	hasVisibleText: (value: string | null | undefined) => value is string;
}) {
	const terminalSize = useTerminalSize();
	const thoughts = item.reasoningContent;
	const content = item.content;
	const showThoughts = hasVisibleText(thoughts);
	const scrollViewHeight = assistantScrollViewHeight(
		terminalSize.height,
		showThoughts,
	);
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
	const mode = useAppStore(selectAppMode);
	const isStreamingContent = mode === "responding" || mode === "compacting";
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
const MIN_THOUGHTBOX_WIDTH = 1;

export function thoughtBoxWidth(terminalWidth: number): number {
	const octoSpace = OCTO_MARGIN + OCTO_PADDING + 1;
	const scrollBorderWidth = 2;
	const contentMaxWidth =
		terminalWidth - THOUGHTBOX_MARGIN - octoSpace - scrollBorderWidth;
	return Math.max(
		MIN_THOUGHTBOX_WIDTH,
		Math.min(contentMaxWidth, MAX_THOUGHTBOX_WIDTH),
	);
}

function ThoughtBox({ thoughts }: { thoughts: string }) {
	const thoughtsRef = useRef<DOMElement | null>(null);
	const [thoughtsHeight, setThoughtsHeight] = useState(0);
	const terminalSize = useTerminalSize();
	const renderedThoughts = useMemo(
		() => normalizeRenderedLineBreaks(thoughts),
		[thoughts],
	);
	const thoughtsOverflow = thoughtsHeight - (MAX_THOUGHTBOX_HEIGHT - 2);
	const isScrollable = useContext(IsScrollableContext);

	useEffect(() => {
		if (thoughtsRef.current) {
			const { height } = measureElement(thoughtsRef.current);
			setThoughtsHeight(height);
		}
	}, [renderedThoughts]);

	const enforceMaxHeight = thoughtsOverflow > 0 && !isScrollable;
	const maxWidth = thoughtBoxWidth(terminalSize.width);

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
					<Text color="gray">{renderedThoughts}</Text>
				</Box>
			</Box>
		</Box>
	);
}
