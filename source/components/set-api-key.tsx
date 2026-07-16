import React, { useState, useCallback } from "react";
import TextInput from "./text-input.tsx";
import { CenteredBox } from "./centered-box.tsx";
import { MenuHeader } from "./menu-panel.tsx";
import { writeKeyForModel } from "../config.ts";
import { PROVIDERS } from "../providers.ts";
import { Span } from "paintcannon-react";
import { useKeyboard } from "../hooks/use-keyboard.ts";
import { TerminalFlex } from "./terminal-flex.tsx";
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
  useKeyboard(event => {
    if (event.key === "Escape") onCancel();
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
    writeKeyForModel(
      {
        baseUrl,
      },
      varValue,
    ).then(
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

      <Span>
        Enter your API key for {name}
        {name !== baseUrl ? "" : "."}
      </Span>

      <TerminalFlex
        style={{
          marginTop: 1,
          marginBottom: 1,
          width: "100%",
          minWidth: 0,
          maxWidth: 80,
        }}
      >
        <TerminalFlex
          style={{
            marginRight: 1,
          }}
        >
          <Span>API key:</Span>
        </TerminalFlex>

        <TextInput value={varValue} onChange={onValueChange} onSubmit={onSubmit} />
      </TerminalFlex>
      {errorMessage && (
        <TerminalFlex
          style={{
            width: "100%",
            minWidth: 0,
            maxWidth: 80,
          }}
        >
          <Span
            style={{
              color: "red",
              fontWeight: "bold",
            }}
          >
            {errorMessage}
          </Span>
        </TerminalFlex>
      )}
    </CenteredBox>
  );
}
