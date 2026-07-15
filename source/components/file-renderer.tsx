import React from "react";
import { CODE_GUTTER_COLOR } from "../theme.ts";
import { countLines, numWidth, fileExtLanguage, extractTrim } from "../str.ts";
import { HighlightedCode } from "../markdown/highlight-code.tsx";
import { Span } from "paintcannon-react";
import { TerminalFlex } from "./terminal-flex.tsx";
export function FileRenderer({
  contents,
  filePath,
  startLineNr,
}: {
  contents: string;
  filePath: string;
  startLineNr?: number;
}) {
  let start = startLineNr || 1;
  const lines = countLines(contents) + start;
  const maxWidth = numWidth(lines);
  const gutterWidth = maxWidth + 1;
  const language = fileExtLanguage(filePath);
  let currentLine = start;
  return (
    <TerminalFlex
      style={{
        paddingLeft: 1,
        paddingRight: 1,
        marginBottom: 1,
        flexDirection: "column",
      }}
    >
      {contents.split("\n").map((line, index) => {
        const lineNumber = currentLine++;
        const matchedLine = extractTrim(line);
        return (
          <TerminalFlex
            key={`${index}-${line}`}
            style={{
              flexGrow: 1,
            }}
          >
            <TerminalFlex
              style={{
                width: gutterWidth,
                flexShrink: 0,
                flexGrow: 1,
                backgroundColor: CODE_GUTTER_COLOR,
                marginRight: 1,
              }}
            >
              <Span>{lineNumber}</Span>
            </TerminalFlex>
            <TerminalFlex
              style={{
                flexGrow: 1,
                width: "100%",
                flexDirection: "column",
              }}
            >
              <TerminalFlex
                style={{
                  flexDirection: "row",
                }}
              >
                <Span>{matchedLine[0]}</Span>
                <TerminalFlex
                  style={{
                    flexDirection: "column",
                  }}
                >
                  <HighlightedCode code={matchedLine[1]} language={language} />
                </TerminalFlex>
                <Span>{matchedLine[2]}</Span>
              </TerminalFlex>
            </TerminalFlex>
          </TerminalFlex>
        );
      })}
    </TerminalFlex>
  );
}
