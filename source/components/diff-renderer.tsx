import React from "react";
import { Box, Text } from "ink";
import { diffLines } from "diff";
import { DIFF_ADDED, DIFF_REMOVED, CODE_GUTTER_COLOR } from "../theme.ts";
import { HighlightedCode } from "../markdown/highlight-code.tsx";
import { readFileSync } from "fs";
import { countLines, numWidth, fileExtLanguage, extractTrim } from "../str.ts";

export function DiffRenderer({ oldText, newText, filepath }: {
  oldText: string,
  newText: string,
  filepath: string,
}) {
  try {
    const language = fileExtLanguage(filepath);
    const file = readFileSync(filepath, "utf8");

    const diff = diffLines(oldText, newText);
    const diffWithChanged: Array<(typeof diff)[number] | {
      added: false,
      removed: false,
      changed: true,
      oldValue: string,
      newValue: string,
    }> = [];

    for(let i = 0; i < diff.length; i++) {
      const curr = diff[i];
      const prev = diffWithChanged.length === 0 ? null : diffWithChanged[diffWithChanged.length - 1];
      if(prev == null) {
        diffWithChanged.push(curr);
        continue;
      }
      if(prev.removed && curr.added) {
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

    const startLine = getStartLine(file, oldText);
    const oldLineCounter = buildLineCounter(startLine);
    const newLineCounter = buildLineCounter(startLine);
    const maxOldLines = startLine + countLines(oldText);
    const maxNewLines = startLine + countLines(newText);
    const lineNrWidth = Math.max(numWidth(maxOldLines), numWidth(maxNewLines));

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" marginY={1}>
          <Box>
            <Box width="50%" paddingX={1}>
              <Text color="gray">Old</Text>
            </Box>
            <Box width="50%" paddingX={1}>
              <Text color="gray">New</Text>
            </Box>
          </Box>
          {
            diffWithChanged.map((part, index) => {
              if(part.added) {
                return <DiffSet
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
              }

              if(part.removed) {
                return <DiffSet
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
              }

              if("changed" in part) {
                return <DiffSet
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
              }

              return <DiffSet
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
            })
          }
        </Box>
      </Box>
    );
  } catch {
    return null;
  }
}

function getStartLine(file: string, search: string) {
  const index = file.indexOf(search);
  if(index < 0) throw new Error("Impossible diff rendering; search string isn't present in file");
  let line = 1;
  for(let i = 0; i < index; i++) {
    const char = file[i];
    if(char === "\n") line++;
  }
  return line;
}

type LineCounter = {
  getLine: () => number,
  incrementLine: () => number,
  getStartLine: () => number,
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
  oldValue, newValue, newAdded, oldRemoved, language, oldLineCounter, newLineCounter, lineNrWidth, oldText, newText
}: {
  oldValue?: string,
  newValue?: string,
  oldRemoved?: boolean,
  newAdded?: boolean,
  oldLineCounter: LineCounter,
  newLineCounter: LineCounter,
  lineNrWidth: number,
  language: string,
  oldText: string,
  newText: string,
}) {
  const gutterWidth = 3 + lineNrWidth;
  return <Box flexDirection="row">
    <LineSegments
      value={oldRemoved ? oldValue?.trim() : oldValue}
      language={language}
      gutterWidth={gutterWidth}
      lineNrWidth={lineNrWidth}
      gutterColor={oldRemoved ? DIFF_REMOVED : CODE_GUTTER_COLOR}
      lineCounter={oldLineCounter}
      originalText={oldText}
    >
      {
        oldRemoved ?
          <Text color="black"> - </Text> :
          <Text>{ "  " }</Text>
      }
    </LineSegments>
    <LineSegments
      value={newAdded ? newValue?.trim() : newValue}
      language={language}
      gutterWidth={gutterWidth}
      lineNrWidth={lineNrWidth}
      gutterColor={newAdded ? DIFF_ADDED : CODE_GUTTER_COLOR}
      lineCounter={newLineCounter}
      originalText={newText}
    >
      {
        newAdded ?
          <Text color="black"> + </Text> :
          <Text>{ "  " }</Text>
      }
    </LineSegments>
  </Box>
}

function LineSegments({
  value, language, gutterColor, gutterWidth, lineNrWidth, lineCounter, children, originalText
}: {
  value: string | undefined,
  language: string,
  gutterColor: string,
  gutterWidth: number,
  lineNrWidth: number,
  lineCounter: LineCounter,
  children: React.ReactNode,
  originalText: string,
}) {
  // Frustratingly, the diffLines function adds newlines at the end of diffs; remove them
  const valueLines = value == null ? [] : value.split("\n");
  if(valueLines.length > 0 && valueLines[valueLines.length - 1] === "") {
    valueLines.pop();
  }
  if(valueLines.length === 0) {
    return <Box width="50%" paddingX={1} flexGrow={1}>
      <Box
        width={gutterWidth}
        flexShrink={0}
        flexGrow={1}
        backgroundColor={gutterColor}
        marginRight={1}
      >
        <Box width={lineNrWidth} flexShrink={0}>
          <Text>
            {  " " }
          </Text>
        </Box>
        { children }
      </Box>
      <Box flexGrow={1} width="100%" flexDirection="column">
        <Text>{ " " }</Text>
      </Box>
    </Box>
  }

  return <Box width="50%" paddingX={1} flexDirection="column" flexGrow={1}>
    {
      valueLines.map((line, index) => {
        const lineNumber = lineCounter.incrementLine();
        return <Box key={`${index}-${line}`} flexGrow={1}>
          <Box
            width={gutterWidth}
            flexShrink={0}
            flexGrow={1}
            backgroundColor={gutterColor}
            marginRight={1}
          >
            <Text>
              { lineNumber }
            </Text>
            { children }
          </Box>
          <Box flexGrow={1} width="100%" flexDirection="column">
            <MaybeHighlighted
              line={line}
              language={language}
              originalText={originalText}
              currentLine={lineNumber}
              startLine={lineCounter.getStartLine()}
            />
          </Box>
        </Box>
      })
    }
  </Box>
}

function MaybeHighlighted({ line, language, originalText, currentLine, startLine }: {
  line: string | undefined,
  language: string,
  originalText: string,
  currentLine: number,
  startLine: number,
}) {
  // Annoyingly, the diffs only include the start of the line from the first character; not the
  // start of the actual line including whitespace. This means we need to find the actual, original
  // line and parse out the whitespace from it rather than using the lines unchanged.
  // Depending on the language, the syntax highlighter might strip some amount of whitespace (my
  // life is pain) and therefore we definitely need the whitespace parsed out, rather than just
  // passing the string as-is to the highlighter.
  const matchedLine = (() => {
    if(line == null) return line;

    // Calculate relative line number within the original text
    const relativeLineNum = currentLine - startLine;

    // Get the original line using the relative line number to find the correct whitespace
    const originalLines = originalText.split("\n");

    if(relativeLineNum >= originalLines.length) {
      console.error(originalLines);
      console.error("Current overall line", currentLine);
      console.error("Relative line", relativeLineNum);
      throw new Error(`Impossible relative line count: ${relativeLineNum} vs original ${originalLines.length}`);
    }

    const originalLine = originalLines[relativeLineNum];
    return extractTrim(originalLine);
  })();


  if(language == "txt") {
    if(matchedLine) return <Text>{matchedLine[0]}{matchedLine[1]}{matchedLine[2]}</Text>
    return <Text>{ " " }</Text>
  }

  if(matchedLine) {
    return <Box flexDirection="row">
      <Text>{ matchedLine[0] }</Text>
      <Box flexDirection="column">
        <HighlightedCode code={matchedLine[1]} language={language} />
      </Box>
      <Text>{ matchedLine[2] }</Text>
    </Box>
  }

  return <Text>{ " " }</Text>
}
