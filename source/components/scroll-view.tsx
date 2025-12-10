import { Box, DOMElement, measureElement, useStdin, Text, BoxProps, useStdout } from 'ink';
import React, { useEffect, useState, useRef, useCallback } from 'react';

// https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h3-Extended-coordinates 
const MOUSE_PATTERNS = {
  URXVT: /\x1b\[(\d+);(\d+);(\d+)M/, // 3 numbers separated by semicolons
  SGR: /\x1b\[<(\d+);(\d+);(\d+)([Mm])/, // like URXVT but ends with m or M
  UTF8: /\x1b\[M(.)(.)(.)/, // 3 characters
} as const;

const SCROLL_DIRECTIONS = {
  SCROLL_UP: "SCROLL_UP",
  SCROLL_DOWN: "SCROLL_DOWN"
} as const;

type ScrollDirection = typeof SCROLL_DIRECTIONS[keyof typeof SCROLL_DIRECTIONS];

const MOUSE_BUTTONS = {
  // https://manpages.ubuntu.com/manpages/jammy/man7/urxvt.7.html#mouse%20reporting escape code reference
  SGR: {
    [SCROLL_DIRECTIONS.SCROLL_UP]: 64,
    [SCROLL_DIRECTIONS.SCROLL_DOWN]: 65,
  },
  // https://manpages.ubuntu.com/manpages/jammy/man7/urxvt.7.html#key%20codes 64/65 with an offset of 32
  URXVT: {
    [SCROLL_DIRECTIONS.SCROLL_UP]: 96,
    [SCROLL_DIRECTIONS.SCROLL_DOWN]: 97,
  },
};

// ASCII Escape codes reference: 
// https://manpages.ubuntu.com/manpages/jammy/man7/urxvt.7.html
const MOUSE_TRACKING = {
  ENABLE: '\x1b[?1000h',
  DISABLE: '\x1b[?1000l',
} as const;

export interface ScrollViewProps extends React.PropsWithChildren {
  height: number;
}

export default function ScrollView({ height, children }: ScrollViewProps) {
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
  }, [shouldAutoScroll]);

  const isScrollable = innerHeight > height;
  const maxScroll = Math.max(0, innerHeight - height);
  const scrollPercentage = maxScroll > 0 ? Math.round((scrollTop / maxScroll) * 100) : 0;

  const handleScroll = useCallback((direction: ScrollDirection) => {
    setScrollTop(prev => {
      const delta = direction === SCROLL_DIRECTIONS.SCROLL_UP ? -1 : 1;
      const newScrollTop = prev + delta;
      const maxScroll = Math.max(0, innerHeight - height);
      const scrollPercentage = maxScroll > 0 ? Math.round((newScrollTop / maxScroll) * 100) : 0;
      if (scrollPercentage >= 99) setShouldAutoScroll(true);
      else setShouldAutoScroll(false);
      return Math.max(0, Math.min(newScrollTop, maxScroll));
    });
  }, [innerHeight, height]);

  useEffect(() => {
    const handleResize = () => {
      setTimeout(handleElementSize, 0);
    };
    process.stdout.on('resize', handleResize);

    return () => {
      process.stdout.off('resize', handleResize);
    };
  }, [handleElementSize]);

  useEffect(() => {
    if (!stdin || !setRawMode || !isScrollable) {
      return;
    }

    setRawMode(true);
    process.stdout.write(MOUSE_TRACKING.ENABLE);

    const handleData = (data: Buffer) => {
      const str = data.toString();

      const urxvtMatch = str.match(MOUSE_PATTERNS.URXVT);
      if (urxvtMatch) {
        const button = parseInt(urxvtMatch[1], 10);
        if (button === MOUSE_BUTTONS.URXVT.SCROLL_UP) {
          handleScroll(SCROLL_DIRECTIONS.SCROLL_UP);
        } else if (button === MOUSE_BUTTONS.URXVT.SCROLL_DOWN) {
          handleScroll(SCROLL_DIRECTIONS.SCROLL_DOWN);
        }
        return;
      }

      const sgrMatch = str.match(MOUSE_PATTERNS.SGR);
      if (sgrMatch) {
        const button = parseInt(sgrMatch[1], 10);
        if (button === MOUSE_BUTTONS.SGR.SCROLL_UP) {
          handleScroll(SCROLL_DIRECTIONS.SCROLL_UP);
        } else if (button === MOUSE_BUTTONS.SGR.SCROLL_DOWN) {
          handleScroll(SCROLL_DIRECTIONS.SCROLL_DOWN);
        }
        return;
      }

      const utf8Match = str.match(MOUSE_PATTERNS.UTF8);
      if (utf8Match) {
        const button = utf8Match[1].charCodeAt(0);
        if (button === MOUSE_BUTTONS.URXVT.SCROLL_UP) {
          handleScroll(SCROLL_DIRECTIONS.SCROLL_UP);
        } else if (button === MOUSE_BUTTONS.URXVT.SCROLL_DOWN) {
          handleScroll(SCROLL_DIRECTIONS.SCROLL_DOWN);
        }
        return;
      }
    };

    stdin.on('data', handleData);

    return () => {
      process.stdout.write(MOUSE_TRACKING.DISABLE);
      stdin.off('data', handleData);
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

  const showTopBorder = scrollPercentage == 0;
  const showBottomBorder = scrollPercentage == 100;

  const SCROLL_UI_COLOR = "cyan"
  const scrollableStyles: BoxProps = {
    borderStyle: "single",
    borderTop: showTopBorder,
    borderBottom: showBottomBorder,
    borderColor: SCROLL_UI_COLOR,
    paddingTop: showTopBorder ? 1 : 0,
    paddingBottom: showBottomBorder ? 1 : 0,
  };

  return (
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
        <Box justifyContent="flex-end">
          <Text color={SCROLL_UI_COLOR} dimColor>
            {scrollPercentage}% {scrollTop > 0 ? '↑' : ''}{scrollTop < maxScroll ? '↓' : ''}
          </Text>
        </Box>
      )}
    </Box>
  );
}