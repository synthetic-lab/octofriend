import {
	Box,
	type BoxProps,
	type DOMElement,
	measureElement,
	Text,
	useStdin,
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

const ESCAPE_SEQUENCE = String.fromCharCode(27);

const MOUSE_PATTERNS = {
	URXVT: new RegExp(`${ESCAPE_SEQUENCE}\\[(\\d+);(\\d+);(\\d+)M`),
	SGR: new RegExp(`${ESCAPE_SEQUENCE}\\[<(\\d+);(\\d+);(\\d+)([Mm])`),
	UTF8: new RegExp(`${ESCAPE_SEQUENCE}\\[M(.)(.)(.)`),
} as const;

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

function parseMouseScrollDirection(str: string): ScrollDirection | undefined {
	const urxvtMatch = str.match(MOUSE_PATTERNS.URXVT);
	if (urxvtMatch) {
		return parseUrXvtButton(Number.parseInt(urxvtMatch[1], 10));
	}

	const sgrMatch = str.match(MOUSE_PATTERNS.SGR);
	if (sgrMatch) {
		return parseSgrButton(Number.parseInt(sgrMatch[1], 10));
	}

	const utf8Match = str.match(MOUSE_PATTERNS.UTF8);
	if (utf8Match) {
		return parseUrXvtButton(utf8Match[1].charCodeAt(0));
	}

	return undefined;
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

	useEffect(() => {
		const handleResize = () => {
			setTimeout(handleElementSize, 0);
		};
		process.stdout.on("resize", handleResize);

		return () => {
			process.stdout.off("resize", handleResize);
		};
	}, [handleElementSize]);

	useEffect(() => {
		if (!(stdin && isScrollable)) {
			return;
		}

		setRawMode(true);
		process.stdout.write(MOUSE_TRACKING.ENABLE);

		const handleData = (data: Buffer) => {
			const direction = parseMouseScrollDirection(data.toString());
			if (direction) {
				handleScroll(direction);
			}
		};

		stdin.on("data", handleData);

		return () => {
			process.stdout.write(MOUSE_TRACKING.DISABLE);
			stdin.off("data", handleData);
			setRawMode(false);
		};
	}, [stdin, setRawMode, isScrollable, handleScroll]);

	useEffect(() => {
		const timer = setTimeout(handleElementSize, 0);
		return () => clearTimeout(timer);
	}, [height, handleElementSize]);

	useEffect(() => {
		const timer = setTimeout(handleElementSize, 0);
		return () => clearTimeout(timer);
	}, [children, handleElementSize]);

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
