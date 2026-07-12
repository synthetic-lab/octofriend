import { Box, Text, useApp } from "ink";
import { useCallback, useContext, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useCtrlC } from "../input/ctrl-c.tsx";
import type { ImageInfo } from "../input/images.ts";
import { type InkInputKey, useLatestInput } from "../input/latest-input.ts";
import { MultimediaInput, VimModeIndicator } from "../input/text.ts";
import { useConfig, useSetConfig } from "../runtime/config/react-context.ts";
import type { Transport } from "../runtime/workspace/common.ts";
import { useTerminalThemeColor } from "../theme/branding.tsx";
import {
	isBottomBarErrorModeData,
	renderBottomBarErrorContent,
} from "./errors.tsx";
import type { InputHistory } from "./input.ts";
import { Loading } from "./loading.tsx";
import {
	matchingSlashCommands,
	projectInitializationPrompt,
	SLASH_COMMANDS,
	slashCommandName,
} from "./slash-commands.ts";
import { useModel } from "./state/model-hook.ts";
import { useAppStore } from "./state/store.ts";
import type { RunArgs, UiState } from "./state/types.ts";
import { ToolRequestsRenderer } from "./tool-requests.tsx";
import { TransportContext } from "./transport-context.tsx";

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

type BottomBarCommandContext = RunArgs & {
	command: string | null;
	finalQuery: string;
	images?: ImageInfo[];
	runInput: NonNullable<
		ReturnType<typeof selectBottomBarContentState>["input"]
	>;
	setConfig: ReturnType<typeof useSetConfig>;
	clearHistory: UiState["clearHistory"];
	compactHistory: UiState["compactHistory"];
	notify: UiState["notify"];
	setQuery: UiState["setQuery"];
	abortResponse: UiState["abortResponse"];
	openMenu: UiState["openMenu"];
	exit: () => void;
};

async function handleBottomBarCommand(
	context: BottomBarCommandContext,
): Promise<boolean> {
	const { command, setQuery, notify } = context;
	if (command === null) return false;
	setQuery("");
	switch (command) {
		case "/clear":
			context.clearHistory();
			notify("Conversation cleared.");
			return true;
		case "/init":
			await context.runInput({
				...context,
				query: projectInitializationPrompt(context.finalQuery),
			});
			return true;
		case "/compact":
			if (useAppStore.getState().history.length === 0) {
				notify("Nothing to compact.");
				return true;
			}
			await context.compactHistory(context);
			return true;
		case "/help":
			notify(
				SLASH_COMMANDS.map(
					({ name, description }) => `${name}: ${description}`,
				).join("\n"),
			);
			return true;
		case "/quit":
			context.abortResponse();
			context.exit();
			return true;
		case "/metrics": {
			const enabled = context.config.showProviderMetrics !== true;
			await context.setConfig({
				...context.config,
				showProviderMetrics: enabled,
			});
			notify(`Provider metrics ${enabled ? "enabled" : "disabled"}.`);
			return true;
		}
		case "/model":
			context.openMenu();
			return true;
		default:
			return false;
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
	const setConfig = useSetConfig();
	const { exit } = useApp();
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
		clearHistory,
		compactHistory,
		notify,
	} = useAppStore(
		useShallow((state) => ({
			...selectBottomBarContentState(state),
			clearHistory: state.clearHistory,
			compactHistory: state.compactHistory,
			notify: state.notify,
		})),
	);

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
			const handled = await handleBottomBarCommand({
				command: slashCommandName(finalQuery),
				finalQuery,
				images,
				runInput: input,
				config,
				transport,
				trajectoryArcRun,
				toolPermission,
				skillDiscover,
				toolDefinitions,
				toolRun,
				setConfig,
				clearHistory,
				compactHistory,
				notify,
				setQuery,
				abortResponse,
				openMenu,
				exit,
			});
			if (handled) return;
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
			abortResponse,
			clearHistory,
			compactHistory,
			config,
			exit,
			input,
			notify,
			openMenu,
			setConfig,
			setQuery,
			skillDiscover,
			toolDefinitions,
			toolPermission,
			toolRun,
			trajectoryArcRun,
			transport,
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
	const slashCommands = matchingSlashCommands(query);
	return (
		<Box flexDirection="column">
			{slashCommands.length > 0 && (
				<Box flexDirection="column" marginLeft={1}>
					{slashCommands.map((command) => (
						<Text key={command.name} color="gray">
							{command.name} — {command.description}
						</Text>
					))}
				</Box>
			)}
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
