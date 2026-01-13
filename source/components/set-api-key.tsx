import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "./text-input.tsx";
import { CenteredBox } from "./centered-box.tsx";
import { MenuHeader } from "./menu-panel.tsx";
import { writeKeyForModel } from "../config.ts";
import { PROVIDERS } from "../providers.ts";

export function SetApiKey({
  baseUrl,
  onComplete,
  onCancel,
}: {
  nickname?: string;
  baseUrl: string;
  onComplete: (apiKey: string) => any;
  onCancel: () => any;
}) {
  const provider = Object.values(PROVIDERS).find(provider => {
    return provider.baseUrl === baseUrl;
  });
  const name = provider?.name || baseUrl;
  const [saving, setSaving] = useState(false);
  const [varValue, setVarValue] = useState("");
  const [errorMessage, setErrorMessage] = useState<null | string>(null);
  useInput((_, key) => {
    if (key.escape) onCancel();
  });

  const onValueChange = useCallback((value: string) => {
    setErrorMessage(null);
    setVarValue(value);
  }, []);

  const onSubmit = useCallback(() => {
    if (varValue === "") {
      setErrorMessage("API key can't be empty");
      return;
    }
    setSaving(true);
    writeKeyForModel({ baseUrl }, varValue).then(
      () => {
        setSaving(false);
        onComplete(varValue);
      },
      () => {
        setSaving(false);
        setErrorMessage("Write to key file failed. Is your filesystem corrupt?");
      },
    );
  }, [varValue]);

  if (saving) {
    return (
      <CenteredBox>
        <MenuHeader title="Saving..." />
      </CenteredBox>
    );
  }

  return (
    <CenteredBox>
      <MenuHeader title="Set the API key" />

      <Text>
        Enter your API key for {name}
        {name !== baseUrl ? "" : "."}
      </Text>

      <Box marginY={1} width={80}>
        <Box marginRight={1}>
          <Text>API key:</Text>
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
