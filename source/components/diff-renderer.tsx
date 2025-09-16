import React from "react";
import { Box, Text } from "ink";
import { diffLines } from "diff";
import { THEME_COLOR, UNCHAINED_COLOR } from "../theme.ts";
import { HighlightedCode } from "../markdown/highlight-code.tsx";

export function DiffRenderer({ oldText, newText, language }: {
  oldText: string,
  newText: string,
  language: string,
}) {
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
  console.error(diffWithChanged);

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
              />
            }

            if(part.removed) {
              return <DiffSet
                key={index}
                oldValue={part.value}
                oldRemoved
                language={language}
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
              />
            }

            return <DiffSet
              key={index}
              oldValue={part.value}
              newValue={part.value}
              language={language}
            />
          })
        }
      </Box>
    </Box>
  );
}

function DiffSet({ oldValue, newValue, newAdded, oldRemoved, language }: {
  oldValue?: string,
  newValue?: string,
  oldRemoved?: boolean,
  newAdded?: boolean,
  language: string,
}) {
  return <Box flexDirection="row">
    <LineSegments value={oldValue} language={language}>
      <Box width={3} backgroundColor={oldRemoved ? UNCHAINED_COLOR : "gray"}>
        {
          oldRemoved ?
            <Text color="black"> - </Text> :
            <Text>{ "   " }</Text>
        }
      </Box>
    </LineSegments>
    <LineSegments value={newValue} language={language}>
      <Box width={3} backgroundColor={newAdded ? THEME_COLOR : "gray"}>
        {
          newAdded ?
            <Text color="black"> + </Text> :
            <Text>{ "   " }</Text>
        }
      </Box>
    </LineSegments>
  </Box>
}

function LineSegments({ value, language, children }: {
  value: string | undefined,
  language: string,
  children: React.ReactNode,
}) {
  if(value == null) {
    return <Box width="50%" paddingX={1}>
      { children }
      <Box flexGrow={1} width="100%" flexDirection="column">
        <Text>{ " " }</Text>
      </Box>
    </Box>
  }
  return <Box width="50%" paddingX={1} flexDirection="column">
    {
      value.split("\n").map(line => {
        return <Box>
          { children }
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
  if(language == "txt") {
    if(line) return <Text>{line}</Text>
    return <Text>{ " " }</Text>
  }
  if(line) {
    return <Box flexDirection="column">
      <HighlightedCode code={line} language={language} />
    </Box>
  }
  return <Text>{ " " }</Text>
}
