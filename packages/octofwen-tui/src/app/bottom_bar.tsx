import { Box, Text, useInput } from "ink";
import type React from "react";
import { useCallback, useContext, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useCtrlC, useCtrlCPressed } from "../input/ctrl_c.tsx";
import type { ImageInfo } from "../input/image_attachments.ts";
import { MultimediaInput, VimModeIndicator } from "../input/text.ts";
import type { Metadata } from "../internal/configuration/metadata.ts";
import { useConfig } from "../internal/configuration/react-context.ts";
import { Menu } from "../menu/app_menu/main.tsx";
import {
	useTerminalThemeColor,
	useTerminalUnchained,
} from "../theme/branding.tsx";
import {
	PaymentErrorScreen,
	RateLimitErrorScreen,
	RequestErrorScreen,
} from "./error_screens.tsx";
import type { InputHistory } from "./input_history.ts";
import { Loading } from "./loading.tsx";
import { useModel } from "./state/model-hook.ts";
import { useAppStore } from "./state/store.ts";
import type { RunArgs } from "./state/types.ts";
import { ToolRequestsRenderer } from "./tool_requests.tsx";
import { TransportContext } from "./transport_context.tsx";

const TEMP_NOTIFICATION_DURATION = 5000;
const NEW_VERSION_MESSAGE =
	"New version released! Run `bun install --global octofwen` to update.";
const CURRENT_VERSION_MESSAGE = "Octo is up-to-date.";

export type BottomBarProps = {
	inputHistory: InputHistory;
	metadata: Metadata;
	tempNotification: string | null;
} & Pick<
	RunArgs,
	| "trajectoryArcRun"
	| "toolPermission"
	| "skillDiscover"
	| "toolDefinitions"
	| "toolRun"
>;

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

export function bottomBarVersionMessage(
	currentVersion: string,
	latestVersion: string | null,
): string {
	if (latestVersion && currentVersion < latestVersion) {
		return NEW_VERSION_MESSAGE;
	}
	return CURRENT_VERSION_MESSAGE;
}

export function BottomBar({
	inputHistory,
	metadata,
	tempNotification,
	trajectoryArcRun,
	toolPermission,
	skillDiscover,
	toolDefinitions,
	toolRun,
}: BottomBarProps) {
	const [versionCheck, setVersionCheck] = useState("Checking for updates...");
	const [displayedTempNotification, setDisplayedTempNotification] =
		useState<React.ReactNode | null>(null);
	const themeColor = useTerminalThemeColor();
	const ctrlCPressed = useCtrlCPressed();
	const { modeData } = useAppStore(
		useShallow((state) => ({
			modeData: state.modeData,
		})),
	);
	const unchained = useTerminalUnchained();

	useEffect(() => {
		getLatestVersion().then((latestVersion) => {
			setVersionCheck(bottomBarVersionMessage(metadata.version, latestVersion));
			if (latestVersion && metadata.version < latestVersion) return;
			setTimeout(() => {
				setVersionCheck("");
			}, 5000);
		});
	}, [metadata]);

	useEffect(() => {
		if (tempNotification) {
			setDisplayedTempNotification(tempNotification);
			const timer = setTimeout(() => {
				setDisplayedTempNotification(null);
			}, TEMP_NOTIFICATION_DURATION);
			return () => clearTimeout(timer);
		}
		return undefined;
	}, [tempNotification]);

	if (modeData.mode === "menu") return <Menu />;

	return (
		<Box flexDirection="column" width="100%">
			<BottomBarContent
				inputHistory={inputHistory}
				trajectoryArcRun={trajectoryArcRun}
				toolPermission={toolPermission}
				skillDiscover={skillDiscover}
				toolDefinitions={toolDefinitions}
				toolRun={toolRun}
			/>
			<Box
				width="100%"
				justifyContent="space-between"
				height={1}
				flexShrink={0}
				flexGrow={1}
			>
				<Box height={1}>
					<Text color={themeColor}>
						{ctrlCPressed && "Press Ctrl+C again to exit."}
					</Text>
					{!ctrlCPressed && (
						<Text color={"gray"}>
							{unchained ? "⚡ Unchained mode" : "Collaboration mode"}{" "}
							<Text dimColor={true}>(Shift+Tab to toggle)</Text>
						</Text>
					)}
				</Box>
				<Text color={themeColor}>{versionCheck}</Text>
			</Box>
			<Box minHeight={1}>
				{displayedTempNotification && (
					<Box width="100%" flexShrink={0}>
						<Text color={themeColor} wrap="wrap">
							{displayedTempNotification}
						</Text>
					</Box>
				)}
			</Box>
		</Box>
	);
}

export async function getLatestVersion() {
	try {
		const response = await fetch("https://registry.npmjs.com/octofwen");
		const contents = await response.json();
		return packageLatestVersion(contents);
	} catch {
		return null;
	}
}

function packageLatestVersion(contents: unknown): string | null {
	if (typeof contents !== "object" || contents === null) return null;
	const distTags = (contents as Record<string, unknown>)["dist-tags"];
	if (typeof distTags !== "object" || distTags === null) return null;
	const latest = (distTags as Record<string, unknown>)["latest"];
	return typeof latest === "string" ? latest : null;
}

function renderBottomBarErrorContent(
	modeData: ReturnType<typeof useAppStore.getState>["modeData"],
) {
	if (modeData.mode === "payment-error") {
		return <PaymentErrorScreen error={modeData.error} />;
	}
	if (modeData.mode === "rate-limit-error") {
		return <RateLimitErrorScreen error={modeData.error} />;
	}
	if (modeData.mode === "request-error") {
		return (
			<RequestErrorScreen
				mode="request-error"
				contextualMessage="It looks like you've hit a request error!"
				error={modeData.error}
				curlCommand={modeData.curlCommand}
			/>
		);
	}
	if (modeData.mode === "compaction-error") {
		return (
			<RequestErrorScreen
				mode="compaction-error"
				contextualMessage="History compaction failed due to a request error!"
				error={modeData.error}
				curlCommand={modeData.curlCommand}
			/>
		);
	}
	return null;
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
	const model = useModel();
	const transport = useContext(TransportContext);
	const vimEnabled = !!config.vimEmulation?.enabled;
	const {
		modeData,
		input,
		abortResponse,
		openMenu,
		closeMenu,
		byteCount,
		setVimMode,
		query,
		setQuery,
	} = useAppStore(
		useShallow((state) => ({
			modeData: state.modeData,
			input: state.input,
			abortResponse: state.abortResponse,
			closeMenu: state.closeMenu,
			openMenu: state.openMenu,
			byteCount: state.byteCount,
			setVimMode: state.setVimMode,
			query: state.query,
			setQuery: state.setQuery,
		})),
	);

	const vimMode =
		vimEnabled && vimEnabled && modeData.mode === "input"
			? modeData.vimMode
			: "NORMAL";

	useCtrlC(() => {
		if (vimEnabled) return;
		setQuery("");
	});

	useInput((input, key) => {
		if (key.escape) {
			if (vimEnabled && vimMode === "INSERT" && modeData.mode === "input") {
				setVimMode("NORMAL");
				return;
			}

			abortResponse();
			if (modeData.mode === "menu") closeMenu();
		}

		if (key.ctrl && input === "p") {
			openMenu();
		}
	});
	const color = useTerminalThemeColor();

	const onSubmit = useCallback(
		async (submittedQuery?: string, images?: ImageInfo[]) => {
			const finalQuery = submittedQuery ?? query;
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
			query,
			config,
			transport,
			setQuery,
			trajectoryArcRun,
			toolPermission,
			toolRun,
		],
	);

	if (modeData.mode === "responding" || modeData.mode === "compacting") {
		return (
			<Box justifyContent="space-between">
				<Loading
					overrideStrings={
						modeData.mode === "compacting"
							? ["Compacting history to save context tokens"]
							: undefined
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
	if (modeData.mode === "error-recovery") return <Loading />;
	if (modeData.mode === "diff-apply") {
		return <Loading overrideStrings={["Auto-fixing diff"]} />;
	}
	if (modeData.mode === "fix-json") {
		return <Loading overrideStrings={["Auto-fixing JSON"]} />;
	}
	if (
		modeData.mode === "payment-error" ||
		modeData.mode === "rate-limit-error" ||
		modeData.mode === "request-error" ||
		modeData.mode === "compaction-error"
	) {
		return renderBottomBarErrorContent(modeData);
	}

	if (modeData.mode === "tool-call") {
		return (
			<ToolRequestsRenderer
				toolReqs={modeData.toolReqs}
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

	const _: "menu" | "input" = modeData.mode;

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
