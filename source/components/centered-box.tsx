import React from "react"
import { Box } from "ink"

export const CenteredBox = React.memo(({ children }: { children?: React.ReactNode }) => {
  return <Box flexDirection="column" justifyContent="center" alignItems="center" height="100%">
    <Box flexDirection="column" width={80}>
      { children }
    </Box>
  </Box>
});
