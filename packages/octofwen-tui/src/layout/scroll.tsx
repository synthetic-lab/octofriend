import {
	Box,
	type BoxProps,
	type DOMElement,
	measureElement,
	Text,
	useStdin,
	useStdout,
} from "ink";
import {
	createContext,
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useTerminalThemeColor } from "../theme/branding.tsx";
import { useStdoutResize } from "./stdout-resize.ts";

const ASCII_ESCAPE = 27;
const ASCII_OPEN_BRACKET = 91;
const ASCII_LESS_THAN = 60;
const ASCII_SEMICOLON = 59;
const ASCII_CAPITAL_M = 77;

const SCROLL_DIRECTIONS = {
	SCROLL_UP: "SCROLL_UP",
	SCROLL_DOWN: "SCROLL_DOWN",
} as const;

type ScrollDirection =
	(typeof SCROLL_DIRECTIONS)[keyof typeof SCROLL_DIRECTIONS];

const MOUSE_BUTTONS = {
	SGR: {
		[SCROLL_DIRECTIONS.SCROLL_UP]: 64,
		[SCROLL_DIRECTIONS.SCROLL_DOWN]: 65,
	},
	URXVT: {
		[SCROLL_DIRECTIONS.SCROLL_UP]: 96,
		[SCROLL_DIRECTIONS.SCROLL_DOWN]: 97,
	},
};

const MOUSE_TRACKING = {
	ENABLE: "\x1b[?1000h",
	DISABLE: "\x1b[?1000l",
} as const;

export type ScrollViewProps = {
	height: number;
	children?: ReactNode;
};

export const IsScrollableContext = createContext(false);

export function parseMouseScrollDirection(
	data: string | Uint8Array,
): ScrollDirection | undefined {
	return typeof data === "string"
		? parseMouseScrollDirectionString(data)
		: parseMouseScrollDirectionBytes(data);
}

function parseMouseScrollDirectionString(
	data: string,
): ScrollDirection | undefined {
	if (data.length < 4) return undefined;
	const bytes = new Uint8Array(data.length);
	for (let index = 0; index < data.length; index += 1) {
		bytes[index] = data.charCodeAt(index);
	}
	return parseMouseScrollDirectionBytes(bytes);
}

function parseMouseScrollDirectionBytes(
	data: Uint8Array,
): ScrollDirection | undefined {
	if (
		data.length < 4 ||
		data[0] !== ASCII_ESCAPE ||
		data[1] !== ASCII_OPEN_BRACKET
	) {
		return undefined;
	}

	if (data[2] === ASCII_CAPITAL_M) {
		return data.length >= 6 ? parseUrXvtButton(data[3]) : undefined;
	}

	const buttonStart = data[2] === ASCII_LESS_THAN ? 3 : 2;
	const button = parseLeadingMouseButton(data, buttonStart);
	if (button === null) return undefined;
	return data[2] === ASCII_LESS_THAN
		? parseSgrButton(button)
		: parseUrXvtButton(button);
}

function parseLeadingMouseButton(
	data: Uint8Array,
	start: number,
): number | null {
	let button = 0;
	let index = start;
	while (index < data.length) {
		const code = data[index];
		if (code === ASCII_SEMICOLON) return index === start ? null : button;
		if (code < 48 || code > 57) return null;
		button = button * 10 + code - 48;
		index += 1;
	}
	return null;
}

function parseUrXvtButton(button: number): ScrollDirection | undefined {
	if (button === MOUSE_BUTTONS.URXVT.SCROLL_UP) {
		return SCROLL_DIRECTIONS.SCROLL_UP;
	}
	if (button === MOUSE_BUTTONS.URXVT.SCROLL_DOWN) {
		return SCROLL_DIRECTIONS.SCROLL_DOWN;
	}
	return undefined;
}

function parseSgrButton(button: number): ScrollDirection | undefined {
	if (button === MOUSE_BUTTONS.SGR.SCROLL_UP) {
		return SCROLL_DIRECTIONS.SCROLL_UP;
	}
	if (button === MOUSE_BUTTONS.SGR.SCROLL_DOWN) {
		return SCROLL_DIRECTIONS.SCROLL_DOWN;
	}
	return undefined;
}

function nextScrollTop({
	direction,
	height,
	innerHeight,
	previousScrollTop,
	setShouldAutoScroll,
}: {
	direction: ScrollDirection;
	height: number;
	innerHeight: number;
	previousScrollTop: number;
	setShouldAutoScroll: (value: boolean) => void;
}): number {
	const delta = direction === SCROLL_DIRECTIONS.SCROLL_UP ? -1 : 1;
	const newScrollTop = previousScrollTop + delta;
	const maxScroll = Math.max(0, innerHeight - height);
	const scrollPercentage =
		maxScroll > 0 ? Math.round((newScrollTop / maxScroll) * 100) : 0;
	setShouldAutoScroll(scrollPercentage >= 99);
	return Math.max(0, Math.min(newScrollTop, maxScroll));
}

export function ScrollView({ height, children }: ScrollViewProps) {
	const [innerHeight, setInnerHeight] = useState(0);
	const [scrollTop, setScrollTop] = useState(0);
	const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
	const innerRef = useRef<DOMElement>(null);
	const { stdin, setRawMode } = useStdin();
	const { stdout } = useStdout();

	const handleElementSize = useCallback(() => {
		if (!innerRef.current) return;
		const dimensions = measureElement(innerRef.current);
		setInnerHeight(dimensions.height);
		if (shouldAutoScroll) {
			const maxScroll = Math.max(0, dimensions.height - height);
			setScrollTop(maxScroll);
		}
	}, [shouldAutoScroll, height]);

	const isScrollable = innerHeight > height;
	const maxScroll = Math.max(0, innerHeight - height);
	const scrollPercentage =
		maxScroll > 0 ? Math.round((scrollTop / maxScroll) * 100) : 0;

	const handleScroll = useCallback(
		(direction: ScrollDirection) => {
			setScrollTop((previousScrollTop) =>
				nextScrollTop({
					direction,
					height,
					innerHeight,
					previousScrollTop,
					setShouldAutoScroll,
				}),
			);
		},
		[innerHeight, height],
	);

	useStdoutResize(handleElementSize);

	useEffect(() => {
		if (!(stdin && isScrollable)) {
			return;
		}

		setRawMode(true);
		stdout.write(MOUSE_TRACKING.ENABLE);

		const handleData = (data: Buffer) => {
			const direction = parseMouseScrollDirection(data);
			if (direction) {
				handleScroll(direction);
			}
		};

		stdin.on("data", handleData);

		return () => {
			stdout.write(MOUSE_TRACKING.DISABLE);
			stdin.off("data", handleData);
			setRawMode(false);
		};
	}, [stdin, stdout, setRawMode, isScrollable, handleScroll]);

	useEffect(() => {
		const timer = setTimeout(handleElementSize, 0);
		return () => clearTimeout(timer);
	}, [height, children, handleElementSize]);

	const scrollUiColor = useTerminalThemeColor();
	const scrollableStyles: BoxProps = {
		borderStyle: "single",
		borderTop: false,
		borderBottom: false,
		borderRight: false,
		paddingLeft: 1,
		borderColor: scrollUiColor,
	};

	return (
		<IsScrollableContext.Provider value={isScrollable}>
			<Box flexDirection="column">
				<Box
					height={isScrollable ? height : undefined}
					flexDirection="column"
					flexShrink={0}
					overflow="hidden"
					{...(isScrollable && scrollableStyles)}
				>
					<Box
						ref={innerRef}
						flexDirection="column"
						flexShrink={0}
						marginTop={-scrollTop}
					>
						{children}
					</Box>
				</Box>
				{isScrollable && (
					<Box justifyContent="flex-start">
						<Text color={scrollUiColor} dimColor={true}>
							{scrollPercentage}% {scrollTop > 0 ? "↑" : ""}
							{scrollTop < maxScroll ? "↓" : ""}
						</Text>
					</Box>
				)}
			</Box>
		</IsScrollableContext.Provider>
	);
}
