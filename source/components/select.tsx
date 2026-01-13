import React from "react";
import { useColor } from "../theme.ts";
import { Box, Text } from "ink";
import figures from "figures";

export const IndicatorComponent = React.memo(({ isSelected = false }: { isSelected?: boolean }) => {
  const themeColor = useColor();
  return (
    <Box marginRight={1}>
      {isSelected ? <Text color={themeColor}>{figures.pointer}</Text> : <Text> </Text>}
    </Box>
  );
});

export const ItemComponent = React.memo(
  ({ isSelected = false, label }: { isSelected?: boolean; label: string }) => {
    const themeColor = useColor();
    return <Text color={isSelected ? themeColor : undefined}>{label}</Text>;
  },
);
