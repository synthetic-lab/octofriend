import { Box, Text } from "ink";
import {
	type Dispatch,
	type MutableRefObject,
	type ReactNode,
	type SetStateAction,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import stringWidth from "string-width";
import { normalizeRenderedLineBreaks } from "../render/lines.ts";
import type { Transport } from "../runtime/workspace/common.ts";
import { searchFiles } from "./file-search.ts";
import {
	type InkInputKey,
	useLatestInput,
	useLatestRef,
} from "./latest-input.ts";
import { FILE_SUGGESTIONS_PRIORITY, usePriorityInput } from "./priority.tsx";

const EMPTY_FILE_RESULTS: string[] = [];
const MAX_DISPLAY_PATH_WIDTH = 50;
const TRUNCATED_PATH_PREFIX = "...";
const DISPLAY_PATH_SUFFIX_WIDTH =
	MAX_DISPLAY_PATH_WIDTH - TRUNCATED_PATH_PREFIX.length;

export { searchFiles };

export type SuggestionListProps = {
	items: string[];
	selectedIndex: number;
};

export type FileSuggestionBoxProps = {
	query: string;
	isVisible: boolean;
	transport: Transport;
	onSelect: (filename: string) => void;
	onDismiss: () => void;
	maxHeight?: number;
};

export type UseFileSearchOptions = {
	transport: Transport;
	onSelect: (filename: string) => void;
	debounceMs?: number;
	enabled?: boolean;
};

type RunFileSearchRequestOptions = {
	query: string;
	transport: Transport;
	signal: AbortSignal | undefined;
	requestId: number;
	currentRequestId: MutableRefObject<number>;
	isMounted: MutableRefObject<boolean>;
	setResults: Dispatch<SetStateAction<string[]>>;
	setSelectedIndex: (selectedIndex: number) => void;
	setIsLoading: (isLoading: boolean) => void;
};

export function stableFileResults(
	previous: string[],
	next: string[],
): string[] {
	if (next.length === 0)
		return previous.length === 0 ? previous : EMPTY_FILE_RESULTS;
	if (previous.length !== next.length) return next;
	let index = 0;
	while (index < next.length) {
		if (previous[index] !== next[index]) return next;
		index += 1;
	}
	return previous;
}

async function runFileSearchRequest({
	query,
	transport,
	signal,
	requestId,
	currentRequestId,
	isMounted,
	setResults,
	setSelectedIndex,
	setIsLoading,
}: RunFileSearchRequestOptions): Promise<void> {
	try {
		if (isMounted.current) {
			setIsLoading(true);
		}

		if (!signal) return;
		const matches = await searchFiles(query, transport, signal);

		if (requestId === currentRequestId.current && isMounted.current) {
			setResults((previous) => stableFileResults(previous, matches));
			setSelectedIndex(0);
		}
	} catch (error) {
		if (
			requestId === currentRequestId.current &&
			isMounted.current &&
			error instanceof Error &&
			error.name !== "AbortError"
		) {
			setResults((previous) => stableFileResults(previous, EMPTY_FILE_RESULTS));
			setSelectedIndex(0);
		}
	} finally {
		if (requestId === currentRequestId.current && isMounted.current) {
			setIsLoading(false);
		}
	}
}

export function useFileSearch(query: string, options: UseFileSearchOptions) {
	const [results, setResults] = useState<string[]>(EMPTY_FILE_RESULTS);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [isLoading, setIsLoading] = useState(false);
	const transport = options.transport;
	const onSelectRef = useLatestRef(options.onSelect);
	const debounceMs = options.debounceMs ?? 100;
	const enabled = options.enabled ?? true;

	const timerRef = useRef<NodeJS.Timeout | undefined>(undefined);
	const currentRequestId = useRef(0);
	const isMounted = useRef(true);
	const abortControllerRef = useRef<AbortController | null>(null);

	useEffect(() => {
		clearTimeout(timerRef.current);

		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
		}

		if (!enabled) {
			currentRequestId.current += 1;
			setResults(EMPTY_FILE_RESULTS);
			setSelectedIndex(0);
			setIsLoading(false);
			abortControllerRef.current = null;
			return;
		}

		const abortController = new AbortController();
		abortControllerRef.current = abortController;

		const thisRequest = ++currentRequestId.current;
		timerRef.current = setTimeout(() => {
			runFileSearchRequest({
				query,
				transport,
				signal: abortController.signal,
				requestId: thisRequest,
				currentRequestId,
				isMounted,
				setResults,
				setSelectedIndex,
				setIsLoading,
			});
		}, debounceMs);

		return () => {
			clearTimeout(timerRef.current);
		};
	}, [debounceMs, enabled, query, transport]);

	useEffect(() => {
		return () => {
			isMounted.current = false;
			currentRequestId.current += 1;
			clearTimeout(timerRef.current);
			abortControllerRef.current?.abort();
		};
	}, []);

	const selectPrev = useCallback(() => {
		setSelectedIndex((previous) => Math.max(0, previous - 1));
	}, []);
	const selectNext = useCallback(() => {
		setSelectedIndex((previous) => {
			if (results.length === 0) return 0;
			const lastIndex = results.length - 1;
			return previous >= lastIndex ? lastIndex : previous + 1;
		});
	}, [results.length]);

	usePriorityInput(
		FILE_SUGGESTIONS_PRIORITY,
		useCallback(
			(_, key) => {
				if (!enabled) return;
				if (key.upArrow || (key.shift && key.tab)) {
					selectPrev();
				} else if (key.downArrow || key.tab) {
					selectNext();
				} else if (key.return) {
					const selected = results[selectedIndex];
					if (selected) {
						onSelectRef.current(selected);
					}
				}
			},
			[enabled, onSelectRef, results, selectedIndex, selectNext, selectPrev],
		),
	);

	return { results, selectedIndex, isLoading };
}

export function SuggestionList({ items, selectedIndex }: SuggestionListProps) {
	const rows = useMemo(
		() => renderSuggestionRows(items, selectedIndex),
		[items, selectedIndex],
	);

	return <Box flexDirection="column">{rows}</Box>;
}

function truncatedDisplayPath(path: string): string {
	if (isPrintableAscii(path)) {
		return path.length <= MAX_DISPLAY_PATH_WIDTH
			? path
			: `${TRUNCATED_PATH_PREFIX}${path.slice(-DISPLAY_PATH_SUFFIX_WIDTH)}`;
	}

	if (stringWidth(path) <= MAX_DISPLAY_PATH_WIDTH) return path;

	let suffixStart = path.length;
	let suffixWidth = 0;
	while (suffixStart > 0 && suffixWidth < DISPLAY_PATH_SUFFIX_WIDTH) {
		const codeUnit = path.charCodeAt(suffixStart - 1);
		const previousStart =
			codeUnit >= 0xdc00 && codeUnit <= 0xdfff && suffixStart > 1
				? suffixStart - 2
				: suffixStart - 1;
		const nextPart = path.slice(previousStart, suffixStart);
		const nextWidth = stringWidth(nextPart);
		if (suffixWidth + nextWidth > DISPLAY_PATH_SUFFIX_WIDTH) break;
		suffixStart = previousStart;
		suffixWidth += nextWidth;
	}

	return `${TRUNCATED_PATH_PREFIX}${path.slice(suffixStart)}`;
}

function isPrintableAscii(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code < 32 || code > 126) return false;
	}
	return true;
}

function renderSuggestionRows(
	items: string[],
	selectedIndex: number,
): ReactNode[] {
	const rows = new Array<ReactNode>(items.length);
	let writeIndex = 0;
	for (let index = 0; index < items.length; index += 1) {
		const item = items[index];
		if (item === undefined) continue;
		const isSelected = index === selectedIndex;
		const displayPath = normalizeRenderedLineBreaks(truncatedDisplayPath(item));
		rows[writeIndex] = (
			<Box key={item}>
				{isSelected ? (
					<Text inverse={true}>{`> ${displayPath}`}</Text>
				) : (
					<Text>{`   ${displayPath}`}</Text>
				)}
			</Box>
		);
		writeIndex += 1;
	}
	if (writeIndex < rows.length) rows.length = writeIndex;
	return rows;
}

export function FileSuggestionBox({
	query,
	isVisible,
	transport,
	onSelect,
	onDismiss,
}: FileSuggestionBoxProps) {
	const onDismissRef = useLatestRef(onDismiss);
	const { results, selectedIndex } = useFileSearch(query, {
		transport,
		onSelect,
		enabled: isVisible,
	});

	const handleInput = useCallback(
		(input: string, key: InkInputKey) => {
			if (isVisible && (key.escape || input === "\x1b")) {
				onDismissRef.current();
			}
		},
		[isVisible, onDismissRef],
	);
	const inputOptions = useMemo(() => ({ isActive: isVisible }), [isVisible]);

	useLatestInput(handleInput, inputOptions);

	if (!isVisible || results.length === 0) {
		return null;
	}

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor="gray"
			width="100%"
		>
			<SuggestionList items={results} selectedIndex={selectedIndex} />
		</Box>
	);
}
