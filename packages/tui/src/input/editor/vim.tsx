import type { Key } from "ink";
import { Box, Text } from "ink";
import React from "react";
import { useTerminalThemeColor } from "../../theme/branding";
import { createVimKeyHandler } from "./vim-handler";
import type {
	VimKeyHandler,
	VimKeyHandlerResult,
	VimMode,
} from "./vim-types";

export type { VimKeyHandler, VimKeyHandlerResult, VimMode };
export { createVimKeyHandler };

export function VimModeIndicator({
	vimEnabled,
	vimMode,
}: {
	vimEnabled: boolean;
	vimMode: VimMode;
}) {
	const themeColor = useTerminalThemeColor();

	if (!vimEnabled || vimMode === "NORMAL") return null;

	return (
		<Box>
			<Text color={themeColor} bold={true}>
				-- INSERT --
			</Text>
		</Box>
	);
}

export function useVimKeyHandler(
	vimMode: VimMode,
	setVimMode: (mode: VimMode) => void,
) {
	const handlerRef = React.useRef<VimKeyHandler | null>(null);
	const setVimModeRef = React.useRef(setVimMode);
	setVimModeRef.current = setVimMode;

	if (handlerRef.current === null) {
		handlerRef.current = createVimKeyHandler((mode) =>
			setVimModeRef.current(mode),
		);
	}

	const handler = handlerRef.current;

	return {
		handle(
			input: string,
			key: Key,
			cursorPosition: number,
			valueLength: number,
			currentValue: string,
		): VimKeyHandlerResult {
			return handler.handle(
				input,
				key,
				cursorPosition,
				valueLength,
				currentValue,
				vimMode,
			);
		},
	};
}
