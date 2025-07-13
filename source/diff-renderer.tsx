import React from "react";
import { Box, Text } from "ink";
import { diffLines } from "diff";

export function DiffRenderer({ oldText, newText }: {
  oldText: string,
  newText: string,
}) {
  const diff = diffLines(oldText, newText);

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginTop={1}>
        {diff.map((part, index) => {
          if (part.added) {
            return (
              <Box key={index} flexDirection="column">
                <Text color="green" bold>
                  + {part.count} lines added
                </Text>
                <Box marginLeft={2} flexDirection="column">
                  {part.value.split('\n').filter(line => line.trim()).map((line, lineIndex) => (
                    <Text key={lineIndex} color="green">
                      + {line}
                    </Text>
                  ))}
                </Box>
              </Box>
            );
          }
          if(part.removed) {
            return (
              <Box key={index} flexDirection="column">
                <Text color="red" bold>
                  - {part.count} lines removed
                </Text>
                <Box marginLeft={2} flexDirection="column">
                  {part.value.split('\n').filter(line => line.trim()).map((line, lineIndex) => (
                    <Text key={lineIndex} color="red">
                      - {line}
                    </Text>
                  ))}
                </Box>
              </Box>
            );
          }
          // Common lines - show context
          const lines = part.value.split('\n').filter(line => line.trim());
          return (
            <Box key={index} flexDirection="column">
              <Text color="gray" italic>
                Context: {lines.length} unchanged lines
              </Text>
              <Box marginLeft={2} flexDirection="column">
                {lines.map((line, lineIndex) => (
                  <Text key={lineIndex} color="gray">
                    · {line}
                  </Text>
                ))}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
