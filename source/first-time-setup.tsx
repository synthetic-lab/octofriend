import React, { useState, useCallback, useLayoutEffect } from "react";
import { Box, Text, useInput, useApp } from "ink";
import fs from "fs/promises";
import path from "path";
import json5 from "json5";
import TextInput from "ink-text-input";
import { Config } from "./config.ts";
import { useColor } from "./theme.ts";
import { ModelSetup } from "./components/auto-detect-models.tsx";
import { MenuHeader } from "./components/menu-panel.tsx";
import { CenteredBox } from "./components/centered-box.tsx";
import { THEME_COLOR } from "./theme.ts";

type SetupStep = {
  step: "welcome",
} | {
  step: "name",
  models: Config["models"],
} | {
  step: "add-model",
} | {
  step: "done",
};

export function FirstTimeSetup({ configPath }: { configPath: string }) {
  const [step, setStep] = useState<SetupStep>({ step: "welcome" });
  const [yourName, setYourName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [ defaultApiKeyOverrides, setDefaultApiKeyOverrides ] = useState<Record<string, string>>({});
  const themeColor = useColor();
  const app = useApp();

  const addOverride = useCallback((override: Record<string, string>) => {
    setDefaultApiKeyOverrides(override);
  }, [ defaultApiKeyOverrides ]);

  useLayoutEffect(() => {
    if(step.step === "done") app.exit();
  }, [ step, app ]);

  const handleWelcomeContinue = useCallback(() => {
    setStep({ step: "add-model" });
  }, []);
  const addModelComplete = useCallback((models: Config["models"]) => {
    setStep({ step: "name", models });
  }, []);
  const addModelCancel = useCallback(() => {
    setStep({ step: "welcome" });
  }, []);

  if(step.step === "welcome") return <WelcomeScreen onContinue={handleWelcomeContinue} />;
  if(step.step === "add-model") {
    return <ModelSetup
      config={null}
      onComplete={addModelComplete}
      onCancel={addModelCancel}
      onOverrideDefaultApiKey={addOverride}
    />
  }
  if(step.step === "done") return null;

  // Assert from typesystem level that we're handled all cases
  const _: "name" = step.step;

  return <CenteredBox>
    <Text color={themeColor}>
      And finally... What's your name?
    </Text>

    <Box marginTop={1}>
      <Box marginRight={1}>
        <Text>Your name:</Text>
      </Box>
      <TextInput
        value={yourName}
        onChange={(value) => {
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
            yourName: trimmedName,
            models: step.models,
          };
          if(defaultApiKeyOverrides) {
            config.defaultApiKeyOverrides = defaultApiKeyOverrides;
          }

          const dir = path.dirname(configPath);
          await fs.mkdir(dir, { recursive: true });
          if(configPath.endsWith("json5")) {
            await fs.writeFile(configPath, json5.stringify(config, null, 2));
          }
          else {
            await fs.writeFile(configPath, JSON.stringify(config, null, 2));
          }
          setStep({ step: "done" });
        }}
      />
    </Box>

    {nameError && (
      <Box marginTop={1}>
        <Text color="red">{nameError}</Text>
      </Box>
    )}
  </CenteredBox>
}

function WelcomeScreen({ onContinue }: { onContinue: () => void }) {

  useInput((_, key) => {
    if(key.return) onContinue();
  });

  return <CenteredBox>
    <MenuHeader title="Welcome to Octo!" />

    <Text>
      You don't seem to have a config file yet, so let's get you set up for the first time.
    </Text>

    <Box marginTop={1}>
      <Text>
        Octo lets you choose the LLM that powers it. Currently, our recommended day-to-day coding
        model to use with Octo is Kimi K2. You can use it via Synthetic, a privacy-focused inference
        company (that we run!); Moonshot.ai, the makers of Kimi K2 (who might train on your data);
        or any OpenAI-compatible Kimi provider.
      </Text>
    </Box>

    <Box marginTop={1}>
      <Text color="gray">
        Be forewarned if you're considering using OpenRouter: many providers serve very broken
        versions of the model.
      </Text>
    </Box>

    <Box marginTop={1}>
      <Text>
        You can add multiple models via Octo's menu: Octo lets you switch models mid-conversation as
        needed to handle different problems. We recommend adding a reasoning model for hard problems
        in addition to Kimi K2: for example, DeepSeek R1-0528, OpenAI o3, or Grok 4. These models
        can also help you come up with an overall plan, and you can then swap in Kimi to do the
        coding.
      </Text>
    </Box>

    <Box marginTop={2} justifyContent="center">
      <Text color={THEME_COLOR}>Press enter when you're ready to begin setup.</Text>
    </Box>
  </CenteredBox>
}
