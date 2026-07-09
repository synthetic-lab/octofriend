import { useApp } from "ink";
import * as React from "react";
import { useLatestInput } from "./latest-input";

export type ExitOnDoubleCtrlCProps = {
	children: React.ReactNode;
	isInputInsertMode?: boolean;
	onExit?: () => void;
	resetDelayMs?: number;
};

const DEFAULT_RESET_DELAY_MS = 2000;
const CTRL_C_INPUT = "\x03";

const CtrlCPressedContext = React.createContext(false);

export function useCtrlC(callback: () => void) {
	useLatestInput(
		React.useCallback(
			(input, key) => {
				if ((key.ctrl && input === "c") || input === CTRL_C_INPUT) {
					callback();
				}
			},
			[callback],
		),
	);
}

export function useCtrlCPressed() {
	return React.useContext(CtrlCPressedContext);
}

export function ExitOnDoubleCtrlC({
	children,
	isInputInsertMode = false,
	onExit,
	resetDelayMs = DEFAULT_RESET_DELAY_MS,
}: ExitOnDoubleCtrlCProps) {
	const [ctrlCPressed, setCtrlCPressed] = React.useState(false);
	const resetTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const { exit } = useApp();
	const exitApplication = onExit ?? exit;
	const clearResetTimer = React.useCallback(() => {
		if (resetTimerRef.current === null) return;
		clearTimeout(resetTimerRef.current);
		resetTimerRef.current = null;
	}, []);

	React.useEffect(() => clearResetTimer, [clearResetTimer]);

	React.useLayoutEffect(() => {
		if (!(isInputInsertMode && ctrlCPressed)) return;
		clearResetTimer();
		setCtrlCPressed(false);
	}, [clearResetTimer, ctrlCPressed, isInputInsertMode]);

	const effectiveCtrlCPressed = ctrlCPressed && !isInputInsertMode;

	useCtrlC(() => {
		if (isInputInsertMode) return;
		if (ctrlCPressed) {
			clearResetTimer();
			exitApplication();
		} else {
			setCtrlCPressed(true);
			clearResetTimer();
			resetTimerRef.current = setTimeout(() => {
				resetTimerRef.current = null;
				setCtrlCPressed(false);
			}, resetDelayMs);
		}
	});

	return (
		<CtrlCPressedContext.Provider value={effectiveCtrlCPressed}>
			{children}
		</CtrlCPressedContext.Provider>
	);
}
