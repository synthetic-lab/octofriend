import React, { useState, useCallback, useLayoutEffect } from "react";
import { Box, Text, useInput, useApp } from "ink";
import fs from "fs/promises";
import path from "path";
import json5 from "json5";
import TextInput from "ink-text-input";
import { Config } from "./config.ts";
import { Octo } from "./components/octo.tsx";
import { useColor } from "./theme.ts";
import { AddModelFlow } from "./components/add-model-flow.tsx";

type SetupStep = {
  step: "welcome",
} | {
  step: "name",
  model: Config["models"][number],
} | {
  step: "add-model",
} | {
  step: "done",
};

export function FirstTimeSetup({ configPath }: { configPath: string }) {
  const [step, setStep] = useState<SetupStep>({ step: "welcome" });
  const [yourName, setYourName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const themeColor = useColor();
  const app = useApp();

  useLayoutEffect(() => {
    if(step.step === "done") app.exit();
  }, [ step, app ]);

  const handleWelcomeContinue = useCallback(() => {
    setStep({ step: "add-model" });
  }, []);
  const addModelComplete = useCallback((model: Config["models"][number]) => {
    setStep({ step: "name", model });
  }, []);
  const addModelCancel = useCallback(() => {
    setStep({ step: "welcome" });
  }, []);

  if(step.step === "welcome") return <WelcomeScreen onContinue={handleWelcomeContinue} />;
  if(step.step === "add-model") {
    return <AddModelFlow onComplete={addModelComplete} onCancel={addModelCancel} />
  }
  if(step.step === "done") return null;

  // Assert from typesystem level that we're handled all cases
  const _: "name" = step.step;

  return <Box flexDirection="column" justifyContent="center" alignItems="center" height="100%">
    <Box flexDirection="column" width={80}>
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
            const config = {
              yourName: trimmedName,
              models: [step.model],
            };

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
    </Box>
  </Box>
}

function WelcomeScreen({ onContinue }: { onContinue: () => void }) {
  const themeColor = useColor();

  useInput((_, key) => {
    if(key.return) onContinue();
  });

  return <Box flexDirection="column" justifyContent="center" alignItems="center" height="100%">
    <Box flexDirection="column" width={80}>
      <Box justifyContent="center" marginBottom={1}>
        <Octo />
        <Box marginLeft={1}>
          <Text color={themeColor} bold>Welcome to Octo!</Text>
        </Box>
      </Box>

      <Text>
        You don't seem to have a config file yet, so let's get you set up for the first time.
      </Text>

      <Box marginTop={1}>
        <Text>
          Octo lets you choose the LLM that powers it. You'll need a few key pieces of
          information, but the first decision you have to make is what inference company to use to
          power your LLM (or, if you're relatively advanced, you can run your own LLM locally on
          your own computer).
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text>
          Currently, our recommended day-to-day coding model to use with Octo is Kimi K2. We
          recommend using it directly from the Moonshot.ai API: in our testing, other inference
          providers are either broken or dumber, in some cases due to quantization behind the scenes.
          We'll update our recommendation as the model hosting landscape evolves.
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text>
          You can also add additional models post-setup by accessing Octo's menu. We recommend
          adding a reasoning model for hard problems in addition to Kimi K2: for example, DeepSeek
          R1-0528, OpenAI o3 or Grok 4. Octo lets you switch models mid-conversation as needed to
          handle different problems. These models can also help you come up with an overall plan,
          and you can then swap in Kimi to do the implementation.
        </Text>
      </Box>

      <Box marginTop={2} justifyContent="center">
        <Text color="gray">Press enter whenever you're ready to begin setup.</Text>
      </Box>
    </Box>
  </Box>
}
