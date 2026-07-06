import { useApp, useInput } from "ink";
import * as React from "react";

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
	useInput((input, key) => {
		if ((key.ctrl && input === "c") || input === CTRL_C_INPUT) {
			callback();
		}
	});
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
	const { exit } = useApp();
	const exitApplication = onExit ?? exit;

	useCtrlC(() => {
		if (ctrlCPressed) {
			exitApplication();
		} else if (!isInputInsertMode) {
			setCtrlCPressed(true);
			setTimeout(() => setCtrlCPressed(false), resetDelayMs);
		}
	});

	return (
		<CtrlCPressedContext.Provider value={ctrlCPressed}>
			{children}
		</CtrlCPressedContext.Provider>
	);
}
