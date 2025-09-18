import React from "react";
import { Box, Text } from "ink";
import { diffLines } from "diff";
import { DIFF_ADDED, DIFF_REMOVED } from "../theme.ts";
import { HighlightedCode } from "../markdown/highlight-code.tsx";
import { readFileSync } from "fs";

export function DiffRenderer({ oldText, newText, filepath }: {
  oldText: string,
  newText: string,
  filepath: string,
}) {
  const dotParts = filepath.split(".");
  let language = "txt";
  if(dotParts.length > 1) language = dotParts[dotParts.length - 1];

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
  const lineNrWidth = Math.max(numSize(maxOldLines), numSize(maxNewLines));

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
              oldLineCounter={oldLineCounter}
              newLineCounter={newLineCounter}
              lineNrWidth={lineNrWidth}
            />
          })
        }
      </Box>
    </Box>
  );
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

function countLines(content: string) {
  return content.split("\n").length;
}

function numSize(num: number) {
  return num.toString().length;
}

type LineCounter = {
  getLine: () => number,
  incrementLine: () => number,
};
function buildLineCounter(startLine: number): LineCounter {
  let curr = startLine;
  return {
    getLine: () => curr,
    incrementLine: () => curr++,
  };
}

function DiffSet({
  oldValue, newValue, newAdded, oldRemoved, language, oldLineCounter, newLineCounter, lineNrWidth
}: {
  oldValue?: string,
  newValue?: string,
  oldRemoved?: boolean,
  newAdded?: boolean,
  oldLineCounter: LineCounter,
  newLineCounter: LineCounter,
  lineNrWidth: number,
  language: string,
}) {
  const gutterWidth = 3 + lineNrWidth;
  return <Box flexDirection="row">
    <LineSegments
      value={oldRemoved ? oldValue?.trim() : oldValue}
      language={language}
      gutterWidth={gutterWidth}
      lineNrWidth={lineNrWidth}
      gutterColor={oldRemoved ? DIFF_REMOVED : "gray"}
      lineCounter={oldLineCounter}
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
      gutterColor={newAdded ? DIFF_ADDED : "gray"}
      lineCounter={newLineCounter}
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
  value, language, gutterColor, gutterWidth, lineNrWidth, lineCounter, children
}: {
  value: string | undefined,
  language: string,
  gutterColor: string,
  gutterWidth: number,
  lineNrWidth: number,
  lineCounter: LineCounter,
  children: React.ReactNode,
}) {
  // Frustratingly, the diffLines function adds newlines at the end of diffs; remove them
  const valueLines = value == null ? [] : value.split("\n");
  if(valueLines.length > 0 && valueLines[valueLines.length - 1] === "") {
    valueLines.pop();
  }
  if(valueLines.length === 0) {
    return <Box width="50%" paddingX={1}>
      <Box
        width={gutterWidth}
        flexShrink={0}
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

  return <Box width="50%" paddingX={1} flexDirection="column">
    {
      valueLines.map((line, index) => {
        return <Box key={`${index}-${line}`}>
          <Box
            width={gutterWidth}
            flexShrink={0}
            backgroundColor={gutterColor}
            marginRight={1}
          >
            <Text>
              { lineCounter.incrementLine() }
            </Text>
            { children }
          </Box>
          <Box flexGrow={1} width="100%" flexDirection="column">
            <MaybeHighlighted line={line} language={language} />
          </Box>
        </Box>
      })
    }
  </Box>
}

function MaybeHighlighted({ line, language }: {
  line: string | undefined,
  language: string,
}) {
  // TODO: we need to actually find the FULL line from the original string (the oldText if
  // applicable, or the newText). The diffs in some cases strip preceding whitespace, and we need
  // that whitespace to correctly render the diff

  if(language == "txt") {
    if(line) return <Text>{line}</Text>
    return <Text>{ " " }</Text>
  }
  if(line) {
    // Ensure spacing is preserved during higlighting by stripping it out and then re-adding it
    // This is annoying but it is what it is
    const spaceBefore = line.match(/(^\s+)/);
    const spaceAfter = line.match(/(\s+$)/);

    return <Box flexDirection="row">
      {
        spaceBefore && <Text>{ spaceBefore[1] }</Text>
      }
      <Box flexDirection="column">
        <HighlightedCode code={line.trim()} language={language} />
      </Box>
      {
        spaceAfter && <Text>{ spaceAfter[1] }</Text>
      }
    </Box>
  }
  return <Text>{ " " }</Text>
}
