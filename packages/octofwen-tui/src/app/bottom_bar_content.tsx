import { Box, Text } from "ink";
import { useCallback, useContext, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useCtrlC } from "../input/ctrl_c.tsx";
import type { ImageInfo } from "../input/image_attachments.ts";
import { type InkInputKey, useLatestInput } from "../input/latest_input.ts";
import { MultimediaInput, VimModeIndicator } from "../input/text.ts";
import { useConfig } from "../internal/configuration/react-context.ts";
import type { Transport } from "../internal/transport/common.ts";
import { useTerminalThemeColor } from "../theme/branding.tsx";
import {
	isBottomBarErrorModeData,
	renderBottomBarErrorContent,
} from "./bottom_bar_errors.tsx";
import type { InputHistory } from "./input_history.ts";
import { Loading } from "./loading.tsx";
import { useModel } from "./state/model-hook.ts";
import { useAppStore } from "./state/store.ts";
import type { RunArgs, UiState } from "./state/types.ts";
import { ToolRequestsRenderer } from "./tool_requests.tsx";
import { TransportContext } from "./transport_context.tsx";

const COMPACTING_LOADING_STRINGS = [
	"Compacting history to save context tokens",
];
const DIFF_APPLY_LOADING_STRINGS = ["Auto-fixing diff"];
const FIX_JSON_LOADING_STRINGS = ["Auto-fixing JSON"];

export type BottomBarContentProps = {
	inputHistory: InputHistory;
} & Pick<
	RunArgs,
	| "trajectoryArcRun"
	| "toolPermission"
	| "skillDiscover"
	| "toolDefinitions"
	| "toolRun"
>;

export function selectBottomBarContentState(state: UiState) {
	const mode = state.modeData.mode;
	const tracksByteCount = mode === "responding" || mode === "compacting";
	return {
		mode,
		vimMode: mode === "input" ? state.modeData.vimMode : "NORMAL",
		toolReqs: mode === "tool-call" ? state.modeData.toolReqs : null,
		errorModeData: isBottomBarErrorModeData(state.modeData)
			? state.modeData
			: null,
		input: mode === "input" ? state.input : null,
		abortResponse: state.abortResponse,
		closeMenu: state.closeMenu,
		openMenu: state.openMenu,
		byteCount: tracksByteCount ? state.byteCount : 0,
		setVimMode: state.setVimMode,
		query: mode === "input" ? state.query : "",
		setQuery: state.setQuery,
	};
}

type BottomBarMode = ReturnType<typeof selectBottomBarContentState>["mode"];

function isStreamingProgressMode(mode: BottomBarMode) {
	return mode === "responding" || mode === "compacting";
}

function isRenderableErrorMode(mode: BottomBarMode) {
	return (
		mode === "auth-error" ||
		mode === "payment-error" ||
		mode === "rate-limit-error" ||
		mode === "request-error" ||
		mode === "compaction-error"
	);
}

type BottomBarKeyboardInput = {
	input: string;
	key: InkInputKey;
	mode: BottomBarMode;
	vimEnabled: boolean;
	vimMode: "INSERT" | "NORMAL";
	abortResponse: () => void;
	closeMenu: () => void;
	openMenu: () => void;
	setVimMode: (vimMode: "INSERT" | "NORMAL") => void;
};

function handleBottomBarKeyboardInput({
	input,
	key,
	mode,
	vimEnabled,
	vimMode,
	abortResponse,
	closeMenu,
	openMenu,
	setVimMode,
}: BottomBarKeyboardInput) {
	if (key.escape) {
		if (vimEnabled && vimMode === "INSERT" && mode === "input") {
			setVimMode("NORMAL");
			return;
		}

		abortResponse();
		if (mode === "menu") closeMenu();
	}

	if (key.ctrl && input === "p") {
		openMenu();
	}
}

export function BottomBarContent({
	inputHistory,
	trajectoryArcRun,
	toolPermission,
	skillDiscover,
	toolDefinitions,
	toolRun,
}: BottomBarContentProps) {
	const config = useConfig();
	const transport = useContext(TransportContext);
	const vimEnabled = !!config.vimEmulation?.enabled;
	const {
		mode,
		vimMode: storeVimMode,
		toolReqs,
		errorModeData,
		input,
		abortResponse,
		openMenu,
		closeMenu,
		byteCount,
		setVimMode,
		query,
		setQuery,
	} = useAppStore(useShallow(selectBottomBarContentState));

	const vimMode = vimEnabled ? storeVimMode : "NORMAL";
	const queryRef = useRef(query);
	queryRef.current = query;

	useCtrlC(
		useCallback(() => {
			if (vimEnabled) return;
			setQuery("");
		}, [setQuery, vimEnabled]),
	);

	const handleInput = useCallback(
		(input: string, key: InkInputKey) => {
			handleBottomBarKeyboardInput({
				input,
				key,
				mode,
				vimEnabled,
				vimMode,
				abortResponse,
				closeMenu,
				openMenu,
				setVimMode,
			});
		},
		[abortResponse, closeMenu, mode, openMenu, setVimMode, vimEnabled, vimMode],
	);

	useLatestInput(handleInput);
	const color = useTerminalThemeColor();

	const onSubmit = useCallback(
		async (submittedQuery?: string, images?: ImageInfo[]) => {
			if (!input) return;
			const finalQuery = submittedQuery ?? queryRef.current;
			setQuery("");
			await input({
				query: finalQuery,
				config,
				transport,
				images,
				trajectoryArcRun,
				toolPermission,
				skillDiscover,
				toolDefinitions,
				toolRun,
			});
		},
		[
			config,
			transport,
			input,
			setQuery,
			skillDiscover,
			trajectoryArcRun,
			toolDefinitions,
			toolPermission,
			toolRun,
		],
	);

	if (isStreamingProgressMode(mode)) {
		return (
			<Box justifyContent="space-between">
				<Loading
					overrideStrings={
						mode === "compacting" ? COMPACTING_LOADING_STRINGS : undefined
					}
				/>
				<Box>
					{byteCount === 0 ? null : (
						<Text color={color}>⇩ {byteCount} bytes</Text>
					)}
					<Text> </Text>
					<Text color="gray">(Press ESC to interrupt)</Text>
				</Box>
			</Box>
		);
	}
	if (mode === "error-recovery") return <Loading />;
	if (mode === "diff-apply") {
		return <Loading overrideStrings={DIFF_APPLY_LOADING_STRINGS} />;
	}
	if (mode === "fix-json") {
		return <Loading overrideStrings={FIX_JSON_LOADING_STRINGS} />;
	}
	if (isRenderableErrorMode(mode)) {
		if (errorModeData === null) return null;
		return renderBottomBarErrorContent(errorModeData);
	}

	if (mode === "tool-call") {
		if (toolReqs === null) return null;
		return (
			<ToolRequestsRenderer
				toolReqs={toolReqs}
				config={config}
				transport={transport}
				trajectoryArcRun={trajectoryArcRun}
				toolPermission={toolPermission}
				skillDiscover={skillDiscover}
				toolDefinitions={toolDefinitions}
				toolRun={toolRun}
			/>
		);
	}

	const _: "menu" | "input" = mode;

	return (
		<BottomBarInputControls
			inputHistory={inputHistory}
			transport={transport}
			query={query}
			setQuery={setQuery}
			onSubmit={onSubmit}
			vimEnabled={vimEnabled}
			vimMode={vimMode}
			setVimMode={setVimMode}
		/>
	);
}

function BottomBarInputControls({
	inputHistory,
	transport,
	query,
	setQuery,
	onSubmit,
	vimEnabled,
	vimMode,
	setVimMode,
}: {
	inputHistory: InputHistory;
	transport: Transport;
	query: string;
	setQuery: (query: string) => void;
	onSubmit: (submittedQuery?: string, images?: ImageInfo[]) => Promise<void>;
	vimEnabled: boolean;
	vimMode: "INSERT" | "NORMAL";
	setVimMode: (vimMode: "INSERT" | "NORMAL") => void;
}) {
	const model = useModel();
	return (
		<Box flexDirection="column">
			<Box marginLeft={1} justifyContent="flex-end">
				<Text color="gray">(Ctrl+p to enter the menu)</Text>
			</Box>
			<MultimediaInput
				inputHistory={inputHistory}
				transport={transport}
				value={query}
				onChange={setQuery}
				onSubmit={onSubmit}
				vimEnabled={vimEnabled}
				vimMode={vimMode}
				setVimMode={setVimMode}
				modalities={model.modalities}
			/>
			<VimModeIndicator vimEnabled={vimEnabled} vimMode={vimMode} />
		</Box>
	);
}
