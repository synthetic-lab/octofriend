import React from "react";
import { CODE_GUTTER_COLOR } from "../theme.ts";
import { countLines, numWidth, fileExtLanguage, extractTrim } from "../str.ts";
import { HighlightedCode } from "../markdown/highlight-code.tsx";
import { Div, Span } from "paintcannon-react";
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
    <Div
      style={{
        display: "flex",
        whiteSpace: "pre-wrap",
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
          <Div
            key={`${index}-${line}`}
            style={{
              display: "flex",
              whiteSpace: "pre-wrap",
              flexGrow: 1,
            }}
          >
            <Div
              style={{
                display: "flex",
                whiteSpace: "pre-wrap",
                width: gutterWidth,
                flexShrink: 0,
                flexGrow: 1,
                backgroundColor: CODE_GUTTER_COLOR,
                marginRight: 1,
              }}
            >
              <Span>{lineNumber}</Span>
            </Div>
            <Div
              style={{
                display: "flex",
                whiteSpace: "pre-wrap",
                flexGrow: 1,
                width: "100%",
                flexDirection: "column",
              }}
            >
              <Div
                style={{
                  display: "flex",
                  whiteSpace: "pre-wrap",
                  flexDirection: "row",
                }}
              >
                <Span>{matchedLine[0]}</Span>
                <Div
                  style={{
                    display: "flex",
                    whiteSpace: "pre-wrap",
                    flexDirection: "column",
                  }}
                >
                  <HighlightedCode code={matchedLine[1]} language={language} />
                </Div>
                <Span>{matchedLine[2]}</Span>
              </Div>
            </Div>
          </Div>
        );
      })}
    </Div>
  );
}
