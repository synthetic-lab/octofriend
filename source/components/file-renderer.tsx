import React from "react";
import { Box, Text } from "ink";
import { readFileSync } from "fs";
import { CODE_GUTTER_COLOR } from "../theme.ts";
import { countLines, numWidth, fileExtLanguage, extractTrim } from "../str.ts";
import { HighlightedCode } from "../markdown/highlight-code.tsx";

export type FileOperation = "append";

export function FileRenderer({
  contents,
  filePath,
  operation,
  startLineNr,
}: {
  contents: string;
  filePath: string;
  operation?: FileOperation;
  startLineNr?: number;
}) {
  let start = startLineNr || 1;

  if (operation === "append") {
    try {
      const file = readFileSync(filePath, "utf8");
      const lines = countLines(file);
      start = lines + 1;
    } catch {
      return null;
    }
  }
  const lines = countLines(contents) + start;
  const maxWidth = numWidth(lines);
  const gutterWidth = maxWidth + 1;
  const language = fileExtLanguage(filePath);
  let currentLine = start;

  return (
    <Box paddingX={1} marginBottom={1} flexDirection="column">
      {contents.split("\n").map((line, index) => {
        const lineNumber = currentLine++;
        const matchedLine = extractTrim(line);

        return (
          <Box key={`${index}-${line}`} flexGrow={1}>
            <Box
              width={gutterWidth}
              flexShrink={0}
              flexGrow={1}
              backgroundColor={CODE_GUTTER_COLOR}
              marginRight={1}
            >
              <Text>{lineNumber}</Text>
            </Box>
            <Box flexGrow={1} width="100%" flexDirection="column">
              <Box flexDirection="row">
                <Text>{matchedLine[0]}</Text>
                <Box flexDirection="column">
                  <HighlightedCode code={matchedLine[1]} language={language} />
                </Box>
                <Text>{matchedLine[2]}</Text>
              </Box>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
