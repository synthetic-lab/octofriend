import figlet from "figlet";
import { Box, Text } from "ink";
import React from "react";

export const TERMINAL_THEME_COLOR = "#72946d";
export const TERMINAL_UNCHAINED_COLOR = "#AA0A0A";
export const DIFF_REMOVED_COLOR = "#880808";
export const DIFF_ADDED_COLOR = "#405e35";
export const CODE_GUTTER_COLOR = "gray";
export const OCTOFWEN_HEADER_FONT = "Delta Corps Priest 1";

export type TerminalHeaderProps = {
	unchained: boolean;
};

export type TerminalThemeProviderProps = {
	unchained: boolean;
	children: React.ReactNode;
};

export const TerminalUnchainedContext = React.createContext<boolean>(false);

export function TerminalThemeProvider({
	unchained,
	children,
}: TerminalThemeProviderProps) {
	return (
		<TerminalUnchainedContext.Provider value={unchained}>
			{children}
		</TerminalUnchainedContext.Provider>
	);
}

export function useTerminalUnchained(): boolean {
	return React.useContext(TerminalUnchainedContext);
}

export function useTerminalThemeColor(): string {
	return getTerminalThemeColor(useTerminalUnchained());
}

export function getTerminalThemeColor(unchained: boolean): string {
	return unchained ? TERMINAL_UNCHAINED_COLOR : TERMINAL_THEME_COLOR;
}

export function TerminalHeader({ unchained }: TerminalHeaderProps) {
	const top = figlet.textSync("Octo", { font: OCTOFWEN_HEADER_FONT });
	const bottom = figlet.textSync("Friend", { font: OCTOFWEN_HEADER_FONT });
	const themeColor = getTerminalThemeColor(unchained);

	return (
		<Box flexDirection="column">
			<Text color={themeColor}>{top}</Text>
			<Text>{bottom}</Text>
		</Box>
	);
}
export function Octo() {
	return <Text>🐙</Text>;
}
