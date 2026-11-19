import React, { useState, useCallback, useLayoutEffect } from "react";
import fs from "fs/promises";
import path from "path";
import json5 from "json5";
import TextInput from "./components/text-input.tsx";
import { Config, CURRENT_CONFIG_VERSION } from "./config.ts";
import { useColor } from "./theme.ts";
import { ModelSetup } from "./components/auto-detect-models.tsx";
import type { SyntheticModel } from "./synthetic-models.ts";
import { MenuHeader } from "./components/menu-panel.tsx";
import { CenteredBox } from "./components/centered-box.tsx";
import { THEME_COLOR } from "./theme.ts";
import { recommendedModel } from "./providers.ts";
import { Span, useApp } from "paintcannon-react";
import { useKeyboard } from "./hooks/use-keyboard.ts";
import { TerminalFlex } from "./components/terminal-flex.tsx";
import { AppShell } from "./components/app-shell.tsx";
type SetupStep =
  | {
      step: "welcome";
    }
  | {
      step: "name";
      models: Config["models"];
    }
  | {
      step: "add-model";
    }
  | {
      step: "done";
    };
type FirstTimeSetupProps = {
  configPath: string;
  syntheticModels: SyntheticModel[];
};
export function FirstTimeSetup({ configPath, syntheticModels }: FirstTimeSetupProps) {
  return (
    <AppShell>
      <TerminalFlex
        style={{
          flexDirection: "column",
          flexGrow: 1,
          flexShrink: 1,
          flexBasis: 0,
          minWidth: 0,
          minHeight: 0,
          width: "100%",
          justifyContent: "center",
        }}
      >
        <FirstTimeSetupContent configPath={configPath} syntheticModels={syntheticModels} />
      </TerminalFlex>
    </AppShell>
  );
}

function FirstTimeSetupContent({ configPath, syntheticModels }: FirstTimeSetupProps) {
  const [step, setStep] = useState<SetupStep>({
    step: "welcome",
  });
  const [yourName, setYourName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [defaultApiKeyOverrides, setDefaultApiKeyOverrides] = useState<Record<string, string>>({});
  const themeColor = useColor();
  const app = useApp();
  const addOverride = useCallback(
    async (override: Record<string, string>) => {
      setDefaultApiKeyOverrides({
        ...defaultApiKeyOverrides,
        ...override,
      });
    },
    [defaultApiKeyOverrides],
  );
  useLayoutEffect(() => {
    if (step.step === "done") app.exit();
  }, [step, app]);
  const handleWelcomeContinue = useCallback(() => {
    setStep({
      step: "add-model",
    });
  }, []);
  const addModelComplete = useCallback((models: Config["models"]) => {
    setStep({
      step: "name",
      models,
    });
  }, []);
  const addModelCancel = useCallback(() => {
    setStep({
      step: "welcome",
    });
  }, []);
  if (step.step === "welcome")
    return <WelcomeScreen syntheticModels={syntheticModels} onContinue={handleWelcomeContinue} />;
  if (step.step === "add-model") {
    return (
      <ModelSetup
        syntheticModels={syntheticModels}
        config={null}
        onComplete={addModelComplete}
        onCancel={addModelCancel}
        onOverrideDefaultApiKey={addOverride}
      />
    );
  }
  if (step.step === "done") return null;

  // Assert from typesystem level that we're handled all cases
  const _: "name" = step.step;
  return (
    <CenteredBox>
      <Span
        style={{
          color: themeColor,
        }}
      >
        And finally... What's your name?
      </Span>

      <TerminalFlex
        style={{
          marginTop: 1,
          width: "100%",
          minWidth: 0,
          alignItems: "center",
        }}
      >
        <TerminalFlex
          style={{
            marginRight: 1,
            flexShrink: 0,
          }}
        >
          <Span>Your name:</Span>
        </TerminalFlex>
        <TerminalFlex
          style={{
            flexGrow: 1,
            flexShrink: 1,
            flexBasis: 0,
            minWidth: 0,
            border: "rounded",
            borderColor: themeColor,
          }}
        >
          <TextInput
            value={yourName}
            onChange={value => {
              setYourName(value);
              setNameError(null);
            }}
            onSubmit={async () => {
              const trimmedName = yourName.trim();
              if (!trimmedName) {
                setNameError("Name can't be empty");
                return;
              }
              setNameError(null);
              const config: Config = {
                configVersion: CURRENT_CONFIG_VERSION,
                yourName: trimmedName,
                models: step.models,
              };
              if (defaultApiKeyOverrides) {
                config.defaultApiKeyOverrides = defaultApiKeyOverrides;
              }
              const dir = path.dirname(configPath);
              await fs.mkdir(dir, {
                recursive: true,
              });
              if (configPath.endsWith("json5")) {
                await fs.writeFile(configPath, json5.stringify(config, null, 2));
              } else {
                await fs.writeFile(configPath, JSON.stringify(config, null, 2));
              }
              setStep({
                step: "done",
              });
            }}
          />
        </TerminalFlex>
      </TerminalFlex>

      {nameError && (
        <TerminalFlex
          style={{
            marginTop: 1,
          }}
        >
          <Span
            style={{
              color: "red",
            }}
          >
            {nameError}
          </Span>
        </TerminalFlex>
      )}
    </CenteredBox>
  );
}
function WelcomeScreen({
  onContinue,
  syntheticModels,
}: {
  onContinue: () => void;
  syntheticModels: SyntheticModel[];
}) {
  const recommended =
    syntheticModels.find(model => model.model === "syn:large:vision") ??
    syntheticModels.find(model => model.categories.includes("recommended"));
  useKeyboard(event => {
    if (event.key === "Enter") onContinue();
  });
  return (
    <CenteredBox>
      <MenuHeader title="Welcome to Octo!" />

      <Span>You don't seem to have a config file, so let's set you up for the first time.</Span>

      <TerminalFlex
        style={{
          marginTop: 1,
        }}
      >
        <Span>
          Octo lets you choose the LLM that powers it. We recommend using{" "}
          {recommended
            ? `${recommended.aliasOf ?? recommended.nickname} via Synthetic`
            : "a model from Synthetic"}
          , our privacy-focused inference service. You can also add closed-source models from OpenAI
          and Anthropic, like {recommendedModel("openai").nickname} and{" "}
          {recommendedModel("anthropic").nickname}.
        </Span>
      </TerminalFlex>

      <TerminalFlex
        style={{
          marginTop: 1,
        }}
      >
        <Span
          style={{
            color: "gray",
          }}
        >
          Be forewarned about using OpenRouter for open-source models: OpenRouter doesn't test model
          implementations, and quality can vary drastically. Many are broken. We'd strongly
          recommend using Synthetic instead.
        </Span>
      </TerminalFlex>

      <TerminalFlex
        style={{
          marginTop: 1,
        }}
      >
        <Span>
          You can add multiple models via Octo's menu: Octo lets you switch models mid-conversation
          as needed to handle different problems. It's often helpful to add a couple of strong
          models; if one gets stuck, another may often be able to solve your problem. Octo works
          with any OpenAI- or Anthropic-compatible API.
        </Span>
      </TerminalFlex>

      <TerminalFlex
        style={{
          marginTop: 2,
          justifyContent: "center",
        }}
      >
        <Span
          style={{
            color: THEME_COLOR,
          }}
        >
          Press enter when you're ready to begin setup.
        </Span>
      </TerminalFlex>
    </CenteredBox>
  );
}
