import { useStdout } from "ink";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { useStdoutResize } from "./stdout-resize";

export type TerminalSize = {
	width: number;
	height: number;
};

export const DEFAULT_TERMINAL_SIZE: TerminalSize = {
	width: 80,
	height: 20,
};

const TerminalSizeContext = createContext<TerminalSize>(DEFAULT_TERMINAL_SIZE);

export type TerminalSizeProviderProps = {
	size: TerminalSize;
	children?: ReactNode;
};

export function TerminalSizeProvider({
	size,
	children,
}: TerminalSizeProviderProps) {
	return (
		<TerminalSizeContext.Provider value={size}>
			{children}
		</TerminalSizeContext.Provider>
	);
}

export function useTerminalSize(): TerminalSize {
	return useContext(TerminalSizeContext);
}

export function useTerminalContentWidth(
	maxWidth = DEFAULT_TERMINAL_SIZE.width,
): number {
	const { width } = useTerminalSize();
	return Math.max(1, Math.min(maxWidth, width));
}

function readStdoutSize(stdout: NodeJS.WriteStream | undefined): TerminalSize {
	return {
		width: stdout?.columns || DEFAULT_TERMINAL_SIZE.width,
		height: stdout?.rows || DEFAULT_TERMINAL_SIZE.height,
	};
}

function terminalSizesEqual(left: TerminalSize, right: TerminalSize): boolean {
	return left.width === right.width && left.height === right.height;
}

export type TerminalSizeTrackerProps = {
	children?: ReactNode;
};

export function TerminalSizeTracker({ children }: TerminalSizeTrackerProps) {
	const { stdout } = useStdout();
	const [size, setSize] = useState<TerminalSize>(() => readStdoutSize(stdout));
	const sizeRef = useRef(size);

	const updateSize = useCallback(() => {
		const nextSize = readStdoutSize(stdout);
		if (terminalSizesEqual(sizeRef.current, nextSize)) return;
		sizeRef.current = nextSize;
		setSize(nextSize);
	}, [stdout]);

	useEffect(() => {
		updateSize();
	}, [updateSize]);

	useStdoutResize(updateSize);

	return <TerminalSizeProvider size={size}>{children}</TerminalSizeProvider>;
}
