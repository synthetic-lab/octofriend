import React from "react";
import { Box } from "ink";

export const CenteredBox = ({ children }: { children?: React.ReactNode }) => {
  return (
    <Box flexDirection="column" justifyContent="center" alignItems="center" height="100%">
      <Box flexDirection="column" width={80}>
        {children}
      </Box>
    </Box>
  );
};

export const HeightlessCenteredBox = ({ children }: { children?: React.ReactNode }) => {
  return (
    <Box flexDirection="column" justifyContent="center" alignItems="center">
      <Box flexDirection="column" width={80}>
        {children}
      </Box>
    </Box>
  );
};
