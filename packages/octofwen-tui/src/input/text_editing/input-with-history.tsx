import { Box, Text, useInput } from "ink";
import { useCallback, useState } from "react";
import type { InputHistory } from "../../app/input_history.ts";
import type { MultimodalConfig } from "../../internal/model-provider-catalog/main.ts";
import type { Transport } from "../../internal/transport/common.ts";
import { useTerminalThemeColor } from "../../theme/branding.tsx";
import { FileSuggestionBox } from "../file_suggestions.tsx";
import type { ImageInfo } from "../image_attachments.ts";
import { TextInput } from "./text-input.tsx";
import type { VimMode } from "./vim.tsx";

const FILE_SUGGESTION_QUERY_REGEX = /^[a-zA-Z0-9_./-]*$/;

export type InputWithHistoryProps = {
	attachedImages: ImageInfo[];
	inputHistory: InputHistory;
	transport: Transport;
	value: string;
	onChange: (value: string) => void;
	onImagePathsAttached?: (imagePaths: string[]) => void | Promise<void>;
	onRemoveLastImage?: () => void;
	onSubmit: (value?: string) => void | Promise<void>;
	showLoadingImageBadge?: boolean;
	vimEnabled?: boolean;
	vimMode?: VimMode;
	setVimMode?: (mode: VimMode) => void;
	modalities?: MultimodalConfig;
};

export function InputWithHistory(props: InputWithHistoryProps) {
	const themeColor = useTerminalThemeColor();
	const [currentIndex, setCurrentIndex] = useState(-1);
	const [originalInput, setOriginalInput] = useState("");
	const [suggestionState, setSuggestionState] = useState<{
		isVisible: boolean;
		triggerPosition: number;
		query: string;
	} | null>(null);
	const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(
		new Set(),
	);

	useInput((input, key) => {
		handleHistoryNavigationInput({
			input,
			key,
			isSuggestionVisible: suggestionState?.isVisible === true,
			currentIndex,
			originalInput,
			value: props.value,
			inputHistory: props.inputHistory,
			onChange: props.onChange,
			setCurrentIndex,
			setOriginalInput,
		});
	});

	const handleSubmit = () => {
		if (suggestionState?.isVisible) {
			return;
		}

		const transformedValue = replaceSelectedMentions(
			props.value,
			selectedSuggestions,
		);

		if (props.value.trim()) {
			props.inputHistory.appendToInputHistory(props.value.trim());
		}

		setCurrentIndex(-1);
		setOriginalInput("");
		setSelectedSuggestions(new Set());
		props.onSubmit(transformedValue);
	};

	const handleChange = (value: string) => {
		if (currentIndex !== -1) {
			setCurrentIndex(-1);
			setOriginalInput("");
		}
		props.onChange(value);

		const atIndex = value.lastIndexOf("@");
		if (atIndex === -1) {
			setSuggestionState(null);
			return;
		}

		const query = value.slice(atIndex + 1);
		if (FILE_SUGGESTION_QUERY_REGEX.test(query)) {
			setSuggestionState({
				isVisible: true,
				triggerPosition: atIndex,
				query,
			});
		} else {
			setSuggestionState(null);
		}
	};

	const handleSuggestionSelect = useCallback(
		(filename: string) => {
			if (!suggestionState) return;

			const before = props.value.slice(0, suggestionState.triggerPosition);
			const after = props.value.slice(
				suggestionState.triggerPosition + suggestionState.query.length + 1,
			);
			const newValue = `${before}@${filename} ${after}`;

			props.onChange(newValue);
			setSelectedSuggestions((prev) => {
				const next = new Set(prev);
				next.add(filename);
				return next;
			});
			setSuggestionState(null);
		},
		[props.value, props.onChange, suggestionState],
	);

	return (
		<Box flexDirection="column">
			<Box
				flexGrow={1}
				flexDirection="column-reverse"
				justifyContent="flex-end"
			>
				{suggestionState?.isVisible && (
					<FileSuggestionBox
						query={suggestionState.query}
						isVisible={suggestionState.isVisible}
						transport={props.transport}
						onSelect={handleSuggestionSelect}
						onDismiss={() => setSuggestionState(null)}
					/>
				)}
			</Box>

			<Box
				width="100%"
				borderLeft={false}
				borderRight={false}
				borderStyle="single"
				borderColor={themeColor}
				gap={1}
			>
				<Text color="gray">&gt;</Text>
				<TextInput
					attachedImages={props.attachedImages}
					showLoadingImageBadge={props.showLoadingImageBadge}
					value={props.value}
					onChange={handleChange}
					onRemoveLastImage={props.onRemoveLastImage}
					onImagePathsAttached={props.onImagePathsAttached}
					onSubmit={handleSubmit}
					vimEnabled={props.vimEnabled}
					vimMode={props.vimMode}
					setVimMode={props.setVimMode}
					modalities={props.modalities}
				/>
			</Box>
		</Box>
	);
}

export function replaceSelectedMentions(
	input: string,
	selectedSuggestions: Set<string>,
): string {
	let output = input;

	for (const filename of selectedSuggestions) {
		const normalizedPath =
			filename.startsWith("/") ||
			filename.startsWith("./") ||
			filename.startsWith("../")
				? filename
				: `./${filename}`;

		const escapedFilename = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const mentionRegex = new RegExp(
			`(^|[^\\w@])@${escapedFilename}(?=$|[^\\w./-])`,
			"g",
		);

		output = output.replace(mentionRegex, `$1${normalizedPath}`);
	}

	return output;
}

type InkInputKey = {
	upArrow?: boolean;
	downArrow?: boolean;
	return?: boolean;
	escape?: boolean;
	backspace?: boolean;
	delete?: boolean;
};

type HistoryNavigationInput = {
	input: string;
	key: InkInputKey;
	isSuggestionVisible: boolean;
	currentIndex: number;
	originalInput: string;
	value: string;
	inputHistory: InputHistory;
	onChange: (value: string) => void;
	setCurrentIndex: (index: number) => void;
	setOriginalInput: (input: string) => void;
};

function handleHistoryNavigationInput(input: HistoryNavigationInput): void {
	if (input.isSuggestionVisible) return;
	if (input.key.upArrow) {
		selectPreviousHistoryItem(input);
		return;
	}
	if (input.key.downArrow) {
		selectNextHistoryItem(input);
		return;
	}
	if (shouldResetHistorySelection(input.input, input.key)) {
		resetHistorySelection(input);
	}
}

function selectPreviousHistoryItem(input: HistoryNavigationInput): void {
	if (input.currentIndex === -1) input.setOriginalInput(input.value);
	const history = input.inputHistory.getCurrentHistory();
	if (history.length === 0) return;
	const newIndex =
		input.currentIndex === -1
			? history.length - 1
			: Math.max(0, input.currentIndex - 1);
	input.setCurrentIndex(newIndex);
	input.onChange(history[newIndex]);
}

function selectNextHistoryItem(input: HistoryNavigationInput): void {
	const history = input.inputHistory.getCurrentHistory();
	if (input.currentIndex === -1 || history.length === 0) return;
	if (input.currentIndex < history.length - 1) {
		const newIndex = input.currentIndex + 1;
		input.setCurrentIndex(newIndex);
		input.onChange(history[newIndex]);
		return;
	}
	input.onChange(input.originalInput);
	input.setCurrentIndex(-1);
}

function shouldResetHistorySelection(input: string, key: InkInputKey): boolean {
	return Boolean(
		input || key.return || key.escape || key.backspace || key.delete,
	);
}

function resetHistorySelection(input: HistoryNavigationInput): void {
	if (input.currentIndex === -1) return;
	input.setCurrentIndex(-1);
	input.setOriginalInput("");
}
