import React from "react";
import { Box, Text } from "ink";

export const Octo = () => {
  return <Text>🐙</Text>;
};

export const OCTO_AVATAR_MARGIN = 1;
export const OCTO_AVATAR_WIDTH = 2;

export default function OctoRow({ children }: { children?: React.ReactNode }) {
  return (
    <Box>
      <Box marginRight={OCTO_AVATAR_MARGIN} width={OCTO_AVATAR_WIDTH} flexShrink={0} flexGrow={0}>
        <Octo />
      </Box>
      {children}
    </Box>
  );
}
