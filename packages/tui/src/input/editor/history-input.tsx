import { Box, Text } from "ink";
import { useCallback, useRef, useState } from "react";
import type { InputHistory } from "../../shell/input";
import { trimWhitespace } from "../../shell/text-processing";
import type { MultimodalConfig } from "../../runtime/models/catalog/main";
import type { Transport } from "../../runtime/workspace/common";
import { useTerminalThemeColor } from "../../theme/branding";
import { FileSuggestionBox } from "../file-suggestions";
import type { ImageInfo } from "../images";
import {
	type InkInputKey,
	useLatestInput,
	useLatestRef,
} from "../latest-input";
import {
	fileSuggestionTrigger,
	pruneSelectedMentions,
	replaceSelectedMentions,
} from "./mentions";
import { TextInput } from "./text-input";
import type { VimMode } from "./vim";

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
	const inputHistoryRef = useLatestRef(props.inputHistory);
	const onChangeRef = useLatestRef(props.onChange);
	const onSubmitRef = useLatestRef(props.onSubmit);
	const selectedSuggestionsRef = useRef(new Set<string>());

	const historyInputHandler = useCallback(
		(input: string, key: InkInputKey) => {
			handleHistoryNavigationInput({
				input,
				key,
				isSuggestionVisible: suggestionState?.isVisible === true,
				currentIndex,
				originalInput,
				value: props.value,
				inputHistory: inputHistoryRef.current,
				onChange: onChangeRef.current,
				setCurrentIndex,
				setOriginalInput,
			});
		},
		[
			currentIndex,
			originalInput,
			inputHistoryRef,
			onChangeRef,
			props.value,
			suggestionState?.isVisible,
		],
	);
	useLatestInput(historyInputHandler);

	const handleSubmit = useCallback(() => {
		if (suggestionState?.isVisible) {
			return;
		}

		const transformedValue = replaceSelectedMentions(
			props.value,
			selectedSuggestionsRef.current,
		);
		const historyValue = trimWhitespace(props.value);

		if (historyValue) {
			inputHistoryRef.current.appendToInputHistory(historyValue);
		}

		setCurrentIndex(-1);
		setOriginalInput("");
		selectedSuggestionsRef.current.clear();
		onSubmitRef.current(transformedValue);
	}, [inputHistoryRef, onSubmitRef, props.value, suggestionState?.isVisible]);

	const handleChange = useCallback(
		(value: string) => {
			pruneSelectedMentions(value, selectedSuggestionsRef.current);
			if (currentIndex !== -1) {
				setCurrentIndex(-1);
				setOriginalInput("");
			}
			onChangeRef.current(value);

			const suggestion = fileSuggestionTrigger(value);
			if (suggestion === null) {
				setSuggestionState(null);
				return;
			}
			setSuggestionState({
				isVisible: true,
				triggerPosition: suggestion.triggerPosition,
				query: suggestion.query,
			});
		},
		[currentIndex, onChangeRef],
	);

	const handleSuggestionSelect = useCallback(
		(filename: string) => {
			if (!suggestionState) return;

			const before = props.value.slice(0, suggestionState.triggerPosition);
			const after = props.value.slice(
				suggestionState.triggerPosition + suggestionState.query.length + 1,
			);
			const newValue = `${before}@${filename} ${after}`;

			onChangeRef.current(newValue);
			selectedSuggestionsRef.current.add(filename);
			setSuggestionState(null);
		},
		[onChangeRef, props.value, suggestionState],
	);

	const dismissSuggestions = useCallback(() => setSuggestionState(null), []);

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
						onDismiss={dismissSuggestions}
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
	const history = input.inputHistory.getCurrentHistory();
	if (history.length === 0) return;
	if (input.currentIndex === -1) input.setOriginalInput(input.value);
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
