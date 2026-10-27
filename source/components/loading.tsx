import React, { useState } from "react";
import Spinner from "./spinner.tsx";
import Shimmer, { shimmerTime } from "./shimmer.tsx";
import { SHIMMER_HIGHLIGHT_COLOR, useColor } from "../theme.ts";
import { useShimmerlock } from "../hooks/use-shimmerlock.ts";
import { Span, useAnimation } from "paintcannon-react";
import { TerminalFlex } from "./terminal-flex.tsx";
const DEFAULT_LOADING_STRINGS = [
  "Scheming",
  "Plotting",
  "Manipulating",
  "Splashing",
  "Yearning",
  "Calculating",
];
export const LONGEST_LOADING_STRING = (() => {
  let longest = DEFAULT_LOADING_STRINGS[0];
  for (let i = 1; i < DEFAULT_LOADING_STRINGS.length; i++) {
    const curr = DEFAULT_LOADING_STRINGS[i];
    if (longest.length < curr.length) {
      longest = curr;
    }
  }
  return longest;
})();
export default function Loading({ overrideStrings }: { overrideStrings?: Array<string> }) {
  const [idx, setIndex] = useState(0);
  const themeColor = useColor();
  const shimmerlock = useShimmerlock("root-loading");
  const loadingStrings = overrideStrings || DEFAULT_LOADING_STRINGS;
  const loadingString = loadingStrings[idx];
  const { frame: dotFrame, reset: resetDots } = useAnimation({
    interval: shimmerTime(loadingString) / 4,
  });
  const dotCount = Math.min(dotFrame, 3);
  return (
    <TerminalFlex>
      <Span
        style={{
          color: "gray",
        }}
      >
        <Spinner type="binary" />
      </Span>
      <Span> </Span>
      <Shimmer
        key={loadingString}
        segments={[
          {
            text: loadingString + ".".repeat(dotCount),
            from: themeColor,
            to: SHIMMER_HIGHLIGHT_COLOR,
          },
        ]}
        lock={shimmerlock}
        running
        onShimmerEnd={() => {
          setIndex((idx + 1) % loadingStrings.length);
          resetDots();
        }}
      />
    </TerminalFlex>
  );
}
