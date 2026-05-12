import { Box, DOMElement, measureElement, Text, BoxProps, useInput } from "ink";
import React, { useEffect, useState, useRef, useCallback, createContext } from "react";
import { useColor } from "../theme.ts";

const SCROLL_DIRECTIONS = {
  SCROLL_UP: "SCROLL_UP",
  SCROLL_DOWN: "SCROLL_DOWN",
} as const;
const SCROLL_LINES = 2;

type ScrollDirection = (typeof SCROLL_DIRECTIONS)[keyof typeof SCROLL_DIRECTIONS];

const ALTERNATE_SCROLL = {
  ENABLE: "\x1b[?1007h",
  DISABLE: "\x1b[?1007l",
} as const;

export interface ScrollViewProps extends React.PropsWithChildren {
  height: number;
  onContentHeightChange?: (height: number) => void;
  onScrollableChange?: (isScrollable: boolean) => void;
}

export const IsScrollableContext = createContext(false);

export function ScrollView({
  height,
  children,
  onContentHeightChange,
  onScrollableChange,
}: ScrollViewProps) {
  const [innerHeight, setInnerHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const innerRef = useRef<DOMElement>(null);

  const handleElementSize = useCallback(() => {
    if (!innerRef.current) return;
    const dimensions = measureElement(innerRef.current);
    setInnerHeight(dimensions.height);
    onContentHeightChange?.(dimensions.height);
    const nextIsScrollable = dimensions.height > height;
    const nextViewportHeight = Math.max(1, height - (nextIsScrollable ? 1 : 0));
    const nextMaxScroll = Math.max(0, dimensions.height - nextViewportHeight);
    if (shouldAutoScroll) {
      setScrollTop(nextMaxScroll);
    } else {
      setScrollTop(prev => Math.min(prev, nextMaxScroll));
    }
  }, [height, onContentHeightChange, shouldAutoScroll]);

  const isScrollable = innerHeight > height;
  const viewportHeight = Math.max(1, height - (isScrollable ? 1 : 0));
  const maxScroll = Math.max(0, innerHeight - viewportHeight);
  const scrollPercentage = maxScroll > 0 ? Math.round((scrollTop / maxScroll) * 100) : 100;

  useEffect(() => {
    onScrollableChange?.(isScrollable);
  }, [isScrollable, onScrollableChange]);

  const handleScroll = useCallback(
    (direction: ScrollDirection) => {
      setScrollTop(prev => {
        const delta = direction === SCROLL_DIRECTIONS.SCROLL_UP ? -SCROLL_LINES : SCROLL_LINES;
        const newScrollTop = prev + delta;
        const isScrollable = innerHeight > height;
        const viewportHeight = Math.max(1, height - (isScrollable ? 1 : 0));
        const maxScroll = Math.max(0, innerHeight - viewportHeight);
        const scrollPercentage = maxScroll > 0 ? Math.round((newScrollTop / maxScroll) * 100) : 0;
        if (scrollPercentage >= 99) setShouldAutoScroll(true);
        else setShouldAutoScroll(false);
        return Math.max(0, Math.min(newScrollTop, maxScroll));
      });
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
    process.stdout.write(ALTERNATE_SCROLL.ENABLE);
    return () => {
      process.stdout.write(ALTERNATE_SCROLL.DISABLE);
    };
  }, []);

  useInput((_, key) => {
    if (!isScrollable) return;
    if (key.shift) return;
    if (key.upArrow) {
      handleScroll(SCROLL_DIRECTIONS.SCROLL_UP);
    } else if (key.downArrow) {
      handleScroll(SCROLL_DIRECTIONS.SCROLL_DOWN);
    }
  });

  useEffect(() => {
    const timer = setTimeout(handleElementSize, 0);
    return () => clearTimeout(timer);
  }, [height, handleElementSize]);

  useEffect(() => {
    const timer = setTimeout(handleElementSize, 0);
    return () => clearTimeout(timer);
  }, [children, handleElementSize]);

  const SCROLL_UI_COLOR = useColor();
  const scrollableStyles: BoxProps = {
    borderStyle: "single",
    borderTop: false,
    borderBottom: false,
    borderRight: false,
    paddingLeft: 1,
    borderColor: SCROLL_UI_COLOR,
  };

  return (
    <IsScrollableContext.Provider value={isScrollable}>
      <Box flexDirection="column" height={height} flexShrink={0} overflow="hidden">
        <Box
          height={viewportHeight}
          flexDirection="column"
          flexShrink={0}
          overflow="hidden"
          {...(isScrollable && scrollableStyles)}
        >
          <Box ref={innerRef} flexDirection="column" flexShrink={0} marginTop={-scrollTop}>
            {children}
          </Box>
        </Box>
        {isScrollable && (
          <Box height={1} justifyContent="flex-start" flexShrink={0}>
            <Text color={SCROLL_UI_COLOR} dimColor>
              {scrollPercentage}% {scrollTop > 0 ? "↑" : ""}
              {scrollTop < maxScroll ? "↓" : ""}
            </Text>
          </Box>
        )}
      </Box>
    </IsScrollableContext.Provider>
  );
}
