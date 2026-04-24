import React, { useCallback, useEffect, useState } from "react";
import { Text, Box } from "ink";
import { KbShortcutPanel } from "./kb-select/kb-shortcut-panel.tsx";
import type { Item, Keymap, ShortcutArray } from "./kb-select/kb-shortcut-select.tsx";
import { LspInstallationConfig } from "../lsp/lsp-server-registry.ts";
import { withServerDisabled, withAllServersDisabled, useConfig, useSetConfig } from "../config.ts";
import { useAppStore } from "../state.ts";
import { execFile } from "node:child_process";
import { useUnchained } from "../theme.ts";
import { MenuHeader } from "./kb-select/kb-shortcut-panel.tsx";

type InstallationChoice = "install" | "skip" | "never" | "disable-all";

type Props = {
  lspRecommendation: LspInstallationConfig;
  onPromptChoice: (choice: InstallationChoice) => void;
};

enum Status {
  Choosing,
  Installing,
  Done,
  Error,
}

type Phase = { status: Status; message?: string };

export function LspRecommendationPrompt({ lspRecommendation, onPromptChoice }: Props) {
  const unchained = useUnchained();
  const setConfig = useSetConfig();
  const lspConfig = useConfig();
  const {
    description,
    extensions,
    serverName,
    installCmd: maybeNullInstallCmd,
  } = lspRecommendation;
  const [phase, setPhase] = useState<Phase>({ status: Status.Choosing });
  const extensionsString = extensions.join(", ");

  useEffect(() => {
    if (unchained) {
      handleInstall();
    }
  }, [unchained]);

  const handleSelect = useCallback(
    (item: Item<InstallationChoice>) => {
      handleChoice(item.value);
    },
    [handleChoice],
  );

  if (!maybeNullInstallCmd) {
    return null;
  }
  const installCmd = maybeNullInstallCmd;

  function dismiss(choice: InstallationChoice, message: string): void {
    useAppStore.getState().notify(message);
    onPromptChoice(choice);
  }

  function handleInstall(): void {
    const { serverName } = lspRecommendation;

    setPhase({ status: Status.Installing, message: `Installing ${serverName}...` });
    const [cmd, ...args] = installCmd;
    execFile(cmd, args, (error, _stdout, stderr) => {
      if (error) {
        const message = `Failed to install ${serverName}: ${stderr || error.message}`;
        setPhase({ status: Status.Error, message });
        dismiss("install", message);
      } else {
        const message = `Successfully installed ${serverName}.`;
        setPhase({ status: Status.Done, message });
        dismiss("install", message);
      }
    });
  }

  function handleSkip(): void {
    const message = "Skipping LSP server installation.";
    setPhase({ status: Status.Done, message });
    dismiss("skip", message);
  }

  function handleNever(): void {
    setConfig(withServerDisabled(lspRecommendation.serverName, lspConfig));
    const message = `"${lspRecommendation.serverName}" LSP is disabled. You won't be asked about it again.`;
    setPhase({ status: Status.Done, message });
    dismiss("never", message);
  }

  function handleDisableAll(): void {
    setConfig(withAllServersDisabled(lspConfig));
    const message = "All future LSP recommendations disabled.";
    setPhase({ status: Status.Done, message });
    dismiss("disable-all", message);
  }

  function handleChoice(choice: InstallationChoice) {
    switch (choice) {
      case "install":
        handleInstall();
        break;
      case "skip":
        handleSkip();
        break;
      case "never":
        handleNever();
        break;
      case "disable-all":
        handleDisableAll();
        break;
    }
  }

  const shortcuts: ShortcutArray<InstallationChoice> = [
    {
      type: "key" as const,
      mapping: {
        y: {
          label: `Yes, install for me with \"${installCmd.join(" ")}\"`,
          value: "install",
        },
        n: { label: "No, not now", value: "skip" },
        x: { label: `Never ask for ${serverName}`, value: "never" },
        d: { label: "Disable all LSP recommendations", value: "disable-all" },
      } satisfies Keymap<InstallationChoice>,
    },
  ];

  if (phase.status === Status.Choosing) {
    return (
      <Box flexDirection="column" marginTop={1} marginBottom={1}>
        <KbShortcutPanel
          title="LSP Plugin Recommendation"
          shortcutItems={shortcuts}
          onSelect={handleSelect}
        >
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text color="dim">
                Installing a Language Server Protocol (LSP) server lets Octo jump to definitions,
                find references, and check types directly instead of reading entire files, saving
                context and tokens.
              </Text>
            </Box>
            <Text>
              LSP Server Suggestion: <Text bold>"{serverName}"</Text>
            </Text>
            <Text>{description}</Text>
            <Text color="dim">
              File types: <Text bold>{extensionsString}</Text>
            </Text>
            <Box marginTop={1} flexDirection="column">
              <Text>Octo can auto-install the right LSP server for you with command:</Text>
              <Text bold>{installCmd.join(" ")}</Text>
            </Box>
          </Box>
        </KbShortcutPanel>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <MenuHeader title="LSP Plugin Recommendation" />
      <Box justifyContent="center" marginBottom={1}>
        <Box flexDirection="column" width={80}>
          {phase.status === Status.Installing && <Text>{phase.message}</Text>}
          {phase.status === Status.Done && <Text color="green">{phase.message}</Text>}
          {phase.status === Status.Error && <Text color="red">{phase.message}</Text>}
        </Box>
      </Box>
    </Box>
  );
}
