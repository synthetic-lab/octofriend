import React from "react";
import { diffLines } from "diff";
import { DIFF_ADDED, DIFF_REMOVED, CODE_GUTTER_COLOR } from "../theme.ts";
import { HighlightedCode } from "../markdown/highlight-code.tsx";
import { countLines, numWidth, fileExtLanguage, extractTrim } from "../str.ts";
import { Div, Span } from "paintcannon-react";
export function DiffRenderer({
  oldText,
  newText,
  fileContents,
  filepath,
}: {
  oldText: string;
  newText: string;
  fileContents: string;
  filepath: string;
}) {
  try {
    const language = fileExtLanguage(filepath);
    const diff = diffLines(oldText, newText);
    const diffWithChanged: Array<
      | (typeof diff)[number]
      | {
          added: false;
          removed: false;
          changed: true;
          oldValue: string;
          newValue: string;
        }
    > = [];
    for (let i = 0; i < diff.length; i++) {
      const curr = diff[i];
      const prev =
        diffWithChanged.length === 0 ? null : diffWithChanged[diffWithChanged.length - 1];
      if (prev == null) {
        diffWithChanged.push(curr);
        continue;
      }
      if (prev.removed && curr.added) {
        diffWithChanged.pop();
        diffWithChanged.push({
          added: false,
          removed: false,
          changed: true,
          oldValue: prev.value,
          newValue: curr.value,
        });
        continue;
      }
      diffWithChanged.push(curr);
    }
    const startLine = getStartLine(fileContents, oldText);
    const oldLineCounter = buildLineCounter(startLine);
    const newLineCounter = buildLineCounter(startLine);
    const maxOldLines = startLine + countLines(oldText);
    const maxNewLines = startLine + countLines(newText);
    const lineNrWidth = Math.max(numWidth(maxOldLines), numWidth(maxNewLines));
    return (
      <Div
        style={{
          display: "flex",
          whiteSpace: "pre-wrap",
          flexDirection: "column",
        }}
      >
        <Div
          style={{
            display: "flex",
            whiteSpace: "pre-wrap",
            flexDirection: "column",
            marginTop: 1,
            marginBottom: 1,
          }}
        >
          <Div
            style={{
              display: "flex",
              whiteSpace: "pre-wrap",
            }}
          >
            <Div
              style={{
                display: "flex",
                whiteSpace: "pre-wrap",
                width: "50%",
                paddingLeft: 1,
                paddingRight: 1,
              }}
            >
              <Span
                style={{
                  color: "gray",
                }}
              >
                Old
              </Span>
            </Div>
            <Div
              style={{
                display: "flex",
                whiteSpace: "pre-wrap",
                width: "50%",
                paddingLeft: 1,
                paddingRight: 1,
              }}
            >
              <Span
                style={{
                  color: "gray",
                }}
              >
                New
              </Span>
            </Div>
          </Div>
          {diffWithChanged.map((part, index) => {
            if (part.added) {
              return (
                <DiffSet
                  key={index}
                  newValue={part.value}
                  newAdded
                  language={language}
                  oldText={oldText}
                  newText={newText}
                  oldLineCounter={oldLineCounter}
                  newLineCounter={newLineCounter}
                  lineNrWidth={lineNrWidth}
                />
              );
            }
            if (part.removed) {
              return (
                <DiffSet
                  key={index}
                  oldValue={part.value}
                  oldRemoved
                  language={language}
                  oldText={oldText}
                  newText={newText}
                  oldLineCounter={oldLineCounter}
                  newLineCounter={newLineCounter}
                  lineNrWidth={lineNrWidth}
                />
              );
            }
            if ("changed" in part) {
              return (
                <DiffSet
                  key={index}
                  oldValue={part.oldValue}
                  newValue={part.newValue}
                  oldRemoved
                  newAdded
                  language={language}
                  oldText={oldText}
                  newText={newText}
                  oldLineCounter={oldLineCounter}
                  newLineCounter={newLineCounter}
                  lineNrWidth={lineNrWidth}
                />
              );
            }
            return (
              <DiffSet
                key={index}
                oldValue={part.value}
                newValue={part.value}
                language={language}
                oldText={oldText}
                newText={newText}
                oldLineCounter={oldLineCounter}
                newLineCounter={newLineCounter}
                lineNrWidth={lineNrWidth}
              />
            );
          })}
        </Div>
      </Div>
    );
  } catch (e) {
    return null;
  }
}
function getStartLine(file: string, search: string) {
  const index = file.indexOf(search);
  if (index < 0) throw new Error("Impossible diff rendering; search string isn't present in file");
  let line = 1;
  for (let i = 0; i < index; i++) {
    const char = file[i];
    if (char === "\n") line++;
  }
  return line;
}
type LineCounter = {
  getLine: () => number;
  incrementLine: () => number;
  getStartLine: () => number;
};
function buildLineCounter(startLine: number): LineCounter {
  let curr = startLine;
  return {
    getLine: () => curr,
    incrementLine: () => curr++,
    getStartLine: () => startLine,
  };
}
function DiffSet({
  oldValue,
  newValue,
  newAdded,
  oldRemoved,
  language,
  oldLineCounter,
  newLineCounter,
  lineNrWidth,
  oldText,
  newText,
}: {
  oldValue?: string;
  newValue?: string;
  oldRemoved?: boolean;
  newAdded?: boolean;
  oldLineCounter: LineCounter;
  newLineCounter: LineCounter;
  lineNrWidth: number;
  language: string;
  oldText: string;
  newText: string;
}) {
  const gutterWidth = 3 + lineNrWidth;
  return (
    <Div
      style={{
        display: "flex",
        whiteSpace: "pre-wrap",
        flexDirection: "row",
      }}
    >
      <LineSegments
        value={oldValue}
        language={language}
        gutterWidth={gutterWidth}
        lineNrWidth={lineNrWidth}
        gutterColor={oldRemoved ? DIFF_REMOVED : CODE_GUTTER_COLOR}
        lineCounter={oldLineCounter}
        originalText={oldText}
      >
        {oldRemoved ? (
          <Span
            style={{
              color: "black",
            }}
          >
            {" "}
            -{" "}
          </Span>
        ) : (
          <Span>{"  "}</Span>
        )}
      </LineSegments>
      <LineSegments
        value={newValue}
        language={language}
        gutterWidth={gutterWidth}
        lineNrWidth={lineNrWidth}
        gutterColor={newAdded ? DIFF_ADDED : CODE_GUTTER_COLOR}
        lineCounter={newLineCounter}
        originalText={newText}
      >
        {newAdded ? (
          <Span
            style={{
              color: "black",
            }}
          >
            {" "}
            +{" "}
          </Span>
        ) : (
          <Span>{"  "}</Span>
        )}
      </LineSegments>
    </Div>
  );
}
function LineSegments({
  value,
  language,
  gutterColor,
  gutterWidth,
  lineNrWidth,
  lineCounter,
  children,
  originalText,
}: {
  value: string | undefined;
  language: string;
  gutterColor: string;
  gutterWidth: number;
  lineNrWidth: number;
  lineCounter: LineCounter;
  children: React.ReactNode;
  originalText: string;
}) {
  // Frustratingly, the diffLines function adds newlines at the end of diffs; remove them
  const valueLines = value == null ? [] : value.split("\n");
  if (valueLines.length > 0 && valueLines[valueLines.length - 1] === "") {
    valueLines.pop();
  }
  if (valueLines.length === 0) {
    return (
      <Div
        style={{
          display: "flex",
          whiteSpace: "pre-wrap",
          width: "50%",
          paddingLeft: 1,
          paddingRight: 1,
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
            backgroundColor: gutterColor,
            marginRight: 1,
          }}
        >
          <Div
            style={{
              display: "flex",
              whiteSpace: "pre-wrap",
              width: lineNrWidth,
              flexShrink: 0,
            }}
          >
            <Span> </Span>
          </Div>
          {children}
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
          <Span> </Span>
        </Div>
      </Div>
    );
  }
  return (
    <Div
      style={{
        display: "flex",
        whiteSpace: "pre-wrap",
        width: "50%",
        paddingLeft: 1,
        paddingRight: 1,
        flexDirection: "column",
        flexGrow: 1,
      }}
    >
      {valueLines.map((line, index) => {
        const lineNumber = lineCounter.incrementLine();
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
                backgroundColor: gutterColor,
                marginRight: 1,
              }}
            >
              <Span>{lineNumber}</Span>
              {children}
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
              <MaybeHighlighted
                line={line}
                language={language}
                originalText={originalText}
                currentLine={lineNumber}
                startLine={lineCounter.getStartLine()}
              />
            </Div>
          </Div>
        );
      })}
    </Div>
  );
}

// Calculate visual width of whitespace (spaces = 1, tabs = 2)
function whitespaceWidth(ws: string): number {
  let width = 0;
  for (const char of ws) {
    if (char === "\t") width += 2;
    else width += 1;
  }
  return width;
}
function MaybeHighlighted({
  line,
  language,
  originalText,
  currentLine,
  startLine,
}: {
  line: string | undefined;
  language: string;
  originalText: string;
  currentLine: number;
  startLine: number;
}) {
  // Annoyingly, the diffs only include the start of the line from the first character; not the
  // start of the actual line including whitespace. This means we need to find the actual, original
  // line and parse out the whitespace from it rather than using the lines unchanged.
  // Depending on the language, the syntax highlighter might strip some amount of whitespace (my
  // life is pain) and therefore we definitely need the whitespace parsed out, rather than just
  // passing the string as-is to the highlighter.
  const matchedLine = (() => {
    if (line == null) return line;

    // Calculate relative line number within the original text
    const relativeLineNum = currentLine - startLine;

    // Get the original line using the relative line number to find the correct whitespace
    const originalLines = originalText.split("\n");
    if (relativeLineNum >= originalLines.length) {
      throw new Error(
        `Impossible relative line count: ${relativeLineNum} vs original ${originalLines.length}`,
      );
    }
    const originalLine = originalLines[relativeLineNum];
    return extractTrim(originalLine);
  })();
  if (language == "txt") {
    if (matchedLine) {
      return (
        <Div
          style={{
            display: "flex",
            whiteSpace: "pre-wrap",
            paddingLeft: whitespaceWidth(matchedLine[0]),
          }}
        >
          <Span>
            {matchedLine[1]}
            {matchedLine[2]}
          </Span>
        </Div>
      );
    }
    return <Span> </Span>;
  }
  if (matchedLine) {
    return (
      <Div
        style={{
          display: "flex",
          whiteSpace: "pre-wrap",
          flexDirection: "column",
          paddingLeft: whitespaceWidth(matchedLine[0]),
        }}
      >
        <HighlightedCode code={matchedLine[1]} language={language} />
      </Div>
    );
  }
  return <Span> </Span>;
}
