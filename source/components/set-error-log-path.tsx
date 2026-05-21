import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "./text-input.tsx";
import { CenteredBox } from "./centered-box.tsx";
import { MenuHeader } from "./menu-panel.tsx";

export function SetErrorLogPath({
  currentPath,
  onComplete,
  onCancel,
}: {
  currentPath: string;
  onComplete: (path: string) => any;
  onCancel: () => any;
}) {
  const [varValue, setVarValue] = useState(currentPath);
  const [errorMessage, setErrorMessage] = useState<null | string>(null);

  useInput((_, key) => {
    if (key.escape) onCancel();
  });

  const onValueChange = useCallback((value: string) => {
    setErrorMessage(null);
    setVarValue(value);
  }, []);

  const onSubmit = useCallback(() => {
    if (varValue.trim() === "") {
      setErrorMessage("Path can't be empty");
      return;
    }
    onComplete(varValue.trim());
  }, [varValue]);

  return (
    <CenteredBox>
      <MenuHeader title="Set error log file path" />

      <Text>Where should Octo save request errors?</Text>

      <Box marginY={1} width={80}>
        <Box marginRight={1}>
          <Text>Path:</Text>
        </Box>

        <TextInput value={varValue} onChange={onValueChange} onSubmit={onSubmit} />
      </Box>
      {errorMessage && (
        <Box width={80}>
          <Text color="red" bold>
            {errorMessage}
          </Text>
        </Box>
      )}
    </CenteredBox>
  );
}
