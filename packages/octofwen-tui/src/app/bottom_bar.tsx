import { Box, Text } from "ink";
import type React from "react";
import { useEffect, useState } from "react";
import { useCtrlCPressed } from "../input/ctrl_c.tsx";
import type { Metadata } from "../internal/configuration/metadata.ts";
import { Menu } from "../menu/app_menu/main.tsx";
import { normalizeRenderedLineBreaks } from "../rendering/line_splitting.ts";
import {
	useTerminalThemeColor,
	useTerminalUnchained,
} from "../theme/branding.tsx";
import {
	BottomBarContent,
	type BottomBarContentProps,
	selectBottomBarContentState,
} from "./bottom_bar_content.tsx";
import type { InputHistory } from "./input_history.ts";
import { useAppStore } from "./state/store.ts";
import type { RunArgs, UiState } from "./state/types.ts";
import {
	bottomBarVersionMessage,
	getLatestVersion,
	useVersionCheck,
} from "./version_check.ts";

export type { BottomBarContentProps };
export {
	BottomBarContent,
	bottomBarVersionMessage,
	getLatestVersion,
	selectBottomBarContentState,
};

const TEMP_NOTIFICATION_DURATION = 5000;

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

export function selectBottomBarMode(state: UiState) {
	return state.modeData.mode;
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
	const mode = useAppStore(selectBottomBarMode);

	if (mode === "menu") return <Menu />;

	return (
		<NormalBottomBar
			inputHistory={inputHistory}
			metadata={metadata}
			tempNotification={tempNotification}
			trajectoryArcRun={trajectoryArcRun}
			toolPermission={toolPermission}
			skillDiscover={skillDiscover}
			toolDefinitions={toolDefinitions}
			toolRun={toolRun}
		/>
	);
}

function NormalBottomBar({
	inputHistory,
	metadata,
	tempNotification,
	trajectoryArcRun,
	toolPermission,
	skillDiscover,
	toolDefinitions,
	toolRun,
}: BottomBarProps) {
	const versionCheck = useVersionCheck(metadata.version);
	const [displayedTempNotification, setDisplayedTempNotification] =
		useState<React.ReactNode | null>(null);
	const themeColor = useTerminalThemeColor();
	const ctrlCPressed = useCtrlCPressed();
	const unchained = useTerminalUnchained();
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
				<Text color={themeColor}>
					{normalizeRenderedLineBreaks(versionCheck)}
				</Text>
			</Box>
			<Box minHeight={1}>
				{displayedTempNotification && (
					<Box width="100%" flexShrink={0}>
						<Text color={themeColor} wrap="wrap">
							{typeof displayedTempNotification === "string"
								? normalizeRenderedLineBreaks(displayedTempNotification)
								: displayedTempNotification}
						</Text>
					</Box>
				)}
			</Box>
		</Box>
	);
}
