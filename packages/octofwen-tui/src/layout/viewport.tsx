import { useStdout } from "ink";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";

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

function readStdoutSize(stdout: NodeJS.WriteStream | undefined): TerminalSize {
	return {
		width: stdout?.columns || DEFAULT_TERMINAL_SIZE.width,
		height: stdout?.rows || DEFAULT_TERMINAL_SIZE.height,
	};
}

export type TerminalSizeTrackerProps = {
	children?: ReactNode;
};

export function TerminalSizeTracker({ children }: TerminalSizeTrackerProps) {
	const [size, setSize] = useState<TerminalSize>(DEFAULT_TERMINAL_SIZE);
	const { stdout } = useStdout();

	useEffect(() => {
		setSize(readStdoutSize(stdout));
	}, []);

	useEffect(() => {
		function handleElementSize() {
			setSize(readStdoutSize(stdout));
		}
		function handleResize() {
			setTimeout(handleElementSize, 0);
		}
		process.stdout.on("resize", handleResize);

		return () => {
			process.stdout.off("resize", handleResize);
		};
	}, [stdout]);

	return <TerminalSizeProvider size={size}>{children}</TerminalSizeProvider>;
}
