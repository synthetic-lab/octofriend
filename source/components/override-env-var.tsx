import React, { useState, useCallback } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { useColor } from "../theme.ts";
import { CenteredBox } from "./centered-box.tsx";
import { MenuHeader } from "./menu-panel.tsx";
import { ProviderConfig } from "./providers.ts";

export type OverrideEnvVarProps = {
  provider: ProviderConfig;
  onSubmit: (val: string) => any;
};

export function OverrideEnvVar({ provider, onSubmit }: OverrideEnvVarProps) {
  const [ inputVal, setInputVal ] = useState("");
  const [ missing, setMissing ] = useState<string | null>(null);
  const themeColor = useColor();

  const handleSubmit = useCallback((val: string) => {
    if(process.env[val]) onSubmit(val);
    else {
      setInputVal("");
      setMissing(val);
    }
  }, [onSubmit]);

  const onChange = useCallback((val: string) => {
    setMissing(null);
    setInputVal(val);
  }, []);

  return (
    <CenteredBox>
      <MenuHeader title="API key" />

      <Box flexDirection="column">
        <Text>
          What environment variable do you use for {provider.name}'s API key?
        </Text>
        <Box borderColor={themeColor} borderStyle={"round"} gap={1}>
          <TextInput value={inputVal} onChange={onChange} onSubmit={handleSubmit} />
        </Box>
        {missing && (
          <Box flexDirection="column">
            <Text color="red">
              It looks like the {missing} env var isn't exported in your current shell.
            </Text>
            <Text color="gray">
              (Hint: do you need to re-source your .bash_profile or .zshrc?)
            </Text>
          </Box>
        )}
      </Box>
    </CenteredBox>
  );
}