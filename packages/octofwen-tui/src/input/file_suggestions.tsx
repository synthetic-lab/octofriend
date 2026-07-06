import ignore from "ignore";
import { Box, Text, useInput } from "ink";
import { type MutableRefObject, useEffect, useRef, useState } from "react";
import type { Transport } from "../internal/transport/common.ts";
import { findFiles } from "../internal/transport/common.ts";
import { FILE_SUGGESTIONS_PRIORITY, usePriorityInput } from "./priority.tsx";

const MAX_SUGGESTIONS = 8;
const CACHE_TTL = 5000;
const GITIGNORE_CACHE_TTL = 300000;

type FileListEntry = {
	files: string[];
	timestamp: number;
};

type GitignoreCacheEntry = {
	content: string;
	timestamp: number;
};

const fileCache = new Map<string, FileListEntry>();
const pendingRequests = new Map<string, Promise<string[]>>();
const gitignoreCache = new Map<string, GitignoreCacheEntry>();

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
};

async function getGitignoreFilter(
	cwd: string,
	readFile: (path: string) => Promise<string>,
): Promise<ignore.Ignore> {
	const cacheKey = cwd;
	const cached = gitignoreCache.get(cacheKey);
	const now = Date.now();

	if (cached && now - cached.timestamp < GITIGNORE_CACHE_TTL) {
		return ignore().add(cached.content);
	}

	const gitignorePath = `${cwd}/.gitignore`;
	let content: string;

	try {
		content = await readFile(gitignorePath);
	} catch {
		return ignore();
	}

	gitignoreCache.set(cacheKey, { content, timestamp: now });
	return ignore().add(content);
}

async function getCachedFileList(
	transport: Transport,
	signal: AbortSignal,
): Promise<string[]> {
	const cwd = transport.cwd;
	const now = Date.now();
	const cached = fileCache.get(cwd);

	if (cached && now - cached.timestamp < CACHE_TTL) {
		return cached.files;
	}

	const pending = pendingRequests.get(cwd);
	if (pending) {
		return pending;
	}

	const readFile = async (filePath: string) =>
		transport.readFile(signal, filePath);
	const ig = await getGitignoreFilter(cwd, readFile);

	const promise = findFiles(signal, transport, {
		type: "f",
	}).then((files) => ig.filter(files));

	pendingRequests.set(cwd, promise);

	try {
		const files = await promise;
		fileCache.set(cwd, { files, timestamp: now });
		return files;
	} finally {
		pendingRequests.delete(cwd);
	}
}

export async function searchFiles(
	query: string,
	transport: Transport,
	signal: AbortSignal,
): Promise<string[]> {
	const files = await getCachedFileList(transport, signal);

	files.sort((a, b) => a.length - b.length);

	if (!query) return files.slice(0, MAX_SUGGESTIONS);

	const queryLower = query.toLowerCase();

	const matches = files.filter((file) =>
		file.toLowerCase().includes(queryLower),
	);
	if (matches.length > 0) {
		return matches.slice(0, MAX_SUGGESTIONS);
	}

	return files
		.filter((file) => {
			const filename = file.split("/").pop()?.toLowerCase() ?? "";
			return filename.startsWith(queryLower);
		})
		.slice(0, 20);
}

type RunFileSearchRequestOptions = {
	query: string;
	transport: Transport;
	signal: AbortSignal | undefined;
	requestId: number;
	currentRequestId: MutableRefObject<number>;
	isMounted: MutableRefObject<boolean>;
	setResults: (results: string[]) => void;
	setSelectedIndex: (selectedIndex: number) => void;
	setIsLoading: (isLoading: boolean) => void;
};

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
			setResults(matches);
			setSelectedIndex(0);
		}
	} catch (error) {
		if (
			requestId === currentRequestId.current &&
			error instanceof Error &&
			error.name !== "AbortError"
		) {
			console.error("Search failed:", error);
		}
	} finally {
		if (requestId === currentRequestId.current && isMounted.current) {
			setIsLoading(false);
		}
	}
}

export function useFileSearch(query: string, options: UseFileSearchOptions) {
	const [results, setResults] = useState<string[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [isLoading, setIsLoading] = useState(false);
	const transport = options.transport;

	const timerRef = useRef<NodeJS.Timeout | undefined>(undefined);
	const currentRequestId = useRef(0);
	const isMounted = useRef(true);
	const abortControllerRef = useRef<AbortController | null>(null);

	useEffect(() => {
		clearTimeout(timerRef.current);

		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
		}
		abortControllerRef.current = new AbortController();

		const thisRequest = ++currentRequestId.current;
		const debounceMs = options.debounceMs ?? 100;

		timerRef.current = setTimeout(() => {
			runFileSearchRequest({
				query,
				transport,
				signal: abortControllerRef.current?.signal,
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
	}, [query, options.debounceMs, transport]);

	useEffect(() => {
		return () => {
			isMounted.current = false;
			clearTimeout(timerRef.current);
			abortControllerRef.current?.abort();
		};
	}, []);

	const selectPrev = () => {
		setSelectedIndex((previous) => Math.max(0, previous - 1));
	};

	usePriorityInput(FILE_SUGGESTIONS_PRIORITY, (_, key) => {
		if (key.upArrow || (key.shift && key.tab)) {
			selectPrev();
		} else if (key.downArrow || key.tab) {
			setSelectedIndex((previous) =>
				Math.min(results.length - 1, previous + 1),
			);
		} else if (key.return) {
			const selected = results[selectedIndex];
			if (selected) {
				options.onSelect(selected);
			}
		}
	});

	return { results, selectedIndex, isLoading };
}

export function SuggestionList({ items, selectedIndex }: SuggestionListProps) {
	return (
		<Box flexDirection="column">
			{items.map((item, index) => {
				const isSelected = index === selectedIndex;
				const displayPath = item.length > 50 ? `...${item.slice(-47)}` : item;

				return (
					<Box key={item}>
						{isSelected ? (
							<Text inverse={true}>{`> ${displayPath}`}</Text>
						) : (
							<Text>{`   ${displayPath}`}</Text>
						)}
					</Box>
				);
			})}
		</Box>
	);
}

export function FileSuggestionBox({
	query,
	isVisible,
	transport,
	onSelect,
	onDismiss,
}: FileSuggestionBoxProps) {
	const { results, selectedIndex } = useFileSearch(query, {
		transport,
		onSelect,
	});

	useInput(
		(_, key) => {
			if (key.escape && isVisible) {
				onDismiss();
			}
		},
		{ isActive: isVisible },
	);

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
