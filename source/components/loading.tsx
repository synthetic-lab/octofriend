import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import Spinner from "./ink/spinner.tsx";
import { useColor } from "../theme.ts";

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

export default React.memo(function Loading({
  overrideStrings,
}: {
  overrideStrings?: Array<string>;
}) {
  const [idx, setIndex] = useState(0);
  const [dotCount, setDotCount] = useState(0);
  const themeColor = useColor();
  const loadingStrings = overrideStrings || DEFAULT_LOADING_STRINGS;

  useEffect(() => {
    let fired = false;
    const timer = setTimeout(() => {
      fired = true;
      if (dotCount >= 3) {
        setDotCount(0);
        setIndex((idx + 1) % loadingStrings.length);
        return;
      }
      setDotCount(dotCount + 1);
    }, 300);

    return () => {
      if (!fired) clearTimeout(timer);
    };
  }, [idx, dotCount]);

  return (
    <Box>
      <Text color="gray">
        <Spinner type="binary" />
      </Text>
      <Text> </Text>
      <Text color={themeColor}>{loadingStrings[idx]}</Text>
      <Text>{".".repeat(dotCount)}</Text>
    </Box>
  );
});
