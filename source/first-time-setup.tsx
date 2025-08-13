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
import SelectInput from "ink-select-input";
import { IndicatorComponent, ItemComponent } from "./components/select.tsx";
import { AutofixModelMenu } from "./components/autofix-model-menu.tsx";
import { SYNTHETIC_PROVIDER, keyFromName } from "./components/providers.ts";
import { CustomAuthFlow } from "./components/add-model-flow.tsx";

type SetupStep = {
  step: "welcome",
} | {
  step: "autofix-setup",
} | {
  step: "autofix-complete",
  autofixConfig: { diffApply: Config["diffApply"], fixJson: Config["fixJson"] },
} | {
  step: "name",
  models: Config["models"],
  autofixConfig?: { diffApply: Config["diffApply"], fixJson: Config["fixJson"] },
} | {
  step: "add-model",
  autofixConfig?: { diffApply: Config["diffApply"], fixJson: Config["fixJson"] },
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

  const addOverride = useCallback(async (override: Record<string, string>) => {
    setDefaultApiKeyOverrides({
      ...defaultApiKeyOverrides,
      ...override,
    });
  }, [ defaultApiKeyOverrides ]);

  useLayoutEffect(() => {
    if(step.step === "done") app.exit();
  }, [ step, app ]);

  const handleWelcomeContinue = useCallback(() => {
    setStep({ step: "autofix-setup" });
  }, []);
  const autofixComplete = useCallback((autofixConfig: { diffApply: Config["diffApply"], fixJson: Config["fixJson"] }) => {
    setStep({ step: "autofix-complete", autofixConfig });
  }, []);
  const autofixSkip = useCallback(() => {
    setStep({ step: "add-model" });
  }, []);
  const autofixCompleteContinue = useCallback(() => {
    if (step.step === "autofix-complete") {
      setStep({ step: "add-model", autofixConfig: step.autofixConfig });
    }
  }, [step]);
  const addModelComplete = useCallback((models: Config["models"]) => {
    if (step.step === "add-model" && step.autofixConfig) {
      setStep({ step: "name", models, autofixConfig: step.autofixConfig });
    } else {
      setStep({ step: "name", models });
    }
  }, [step]);
  const addModelCancel = useCallback(() => {
    if (step.step === "add-model" && step.autofixConfig) {
      setStep({ step: "autofix-complete", autofixConfig: step.autofixConfig });
    } else {
      setStep({ step: "welcome" });
    }
  }, [step]);

  if(step.step === "welcome") return <WelcomeScreen onContinue={handleWelcomeContinue} />;
  if(step.step === "autofix-setup") {
    return <AutofixSetup
      onComplete={autofixComplete}
      onSkip={autofixSkip}
      onOverrideDefaultApiKey={async (envVar) => {
        addOverride({
          [keyFromName(SYNTHETIC_PROVIDER.name)]: envVar,
        });
      }}
    />;
  }
  if(step.step === "autofix-complete") {
    return <AutofixCompleteScreen onContinue={autofixCompleteContinue} />;
  }
  if(step.step === "add-model") {
    return <ModelSetup
      config={null}
      onComplete={addModelComplete}
      onCancel={addModelCancel}
      onOverrideDefaultApiKey={addOverride}
      titleOverride={
        step.autofixConfig ? undefined :
          "Okay, we'll skip that for now. Let's set you up with a coding model. Which inference provider do you want to use?"
      }
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
          if(step.autofixConfig) {
            config.diffApply = step.autofixConfig.diffApply;
            config.fixJson = step.autofixConfig.fixJson;
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

type AutofixStates = "choose"
                   | "synthetic-setup"
                   | "diff-apply-custom"
                   | "fix-json-custom"
                   ;
function AutofixSetup({ onComplete, onSkip, onOverrideDefaultApiKey }: {
  onComplete: (config: { diffApply: Config["diffApply"], fixJson: Config["fixJson"] }) => void,
  onSkip: () => void,
  onOverrideDefaultApiKey: (envVar: string) => Promise<void>,
}) {
  const [autofixStep, setAutofixStep] = useState<AutofixStates>("choose");
  const [diffApplyConfig, setDiffApplyConfig] = useState<Config["diffApply"]>();

  const items = [
    {
      label: "💫 Enable autofix models via Synthetic (recommended)",
      value: "synthetic",
    },
    {
      label: "Use custom models...",
      value: "custom",
    },
    {
      label: "Skip for now (can be enabled later)",
      value: "skip",
    },
  ];

  const onSelect = useCallback((item: (typeof items)[number]) => {
    if (item.value === "synthetic") {
      const defaultEnvVar = SYNTHETIC_PROVIDER.envVar;
      if (process.env[defaultEnvVar]) {
        onComplete({
          diffApply: {
            baseUrl: SYNTHETIC_PROVIDER.baseUrl,
            model: "hf:syntheticlab/diff-apply",
          },
          fixJson: {
            baseUrl: SYNTHETIC_PROVIDER.baseUrl,
            model: "hf:syntheticlab/fix-json",
          },
        });
      } else {
        setAutofixStep("synthetic-setup");
      }
    } else if (item.value === "custom") {
      setAutofixStep("diff-apply-custom");
    } else {
      onSkip();
    }
  }, [onComplete, onSkip]);

  if (autofixStep === "synthetic-setup") {
    return <CustomAuthFlow
      config={null}
      onComplete={async (envVar) => {
        if(envVar) await onOverrideDefaultApiKey(envVar);
        onComplete({
          diffApply: {
            baseUrl: SYNTHETIC_PROVIDER.baseUrl,
            model: "hf:syntheticlab/diff-apply",
          },
          fixJson: {
            baseUrl: SYNTHETIC_PROVIDER.baseUrl,
            model: "hf:syntheticlab/fix-json",
          },
        });
      }}
      onCancel={() => setAutofixStep("choose")}
      baseUrl={SYNTHETIC_PROVIDER.baseUrl}
    />
  }

  if (autofixStep === "diff-apply-custom") {
    return <AutofixModelMenu
      config={null}
      defaultModel="hf:syntheticlab/diff-apply"
      modelNickname="diff-apply"
      onOverrideDefaultApiKey={onOverrideDefaultApiKey}
      onComplete={(config) => {
        setDiffApplyConfig(config);
        setAutofixStep("fix-json-custom");
      }}
      onCancel={() => setAutofixStep("choose")}
    >
      <Text>
        Even good coding models sometimes make minor mistakes generating code diffs, which can cause
        slow retries and can confuse them, since models often aren't trained as well to handle
        edit failures as they are successes. Diff-apply is a fast, small model that fixes minor
        code diff edit inaccuracies. It speeds up iteration and can significantly improve model
        performance.
      </Text>
    </AutofixModelMenu>
  }

  if (autofixStep === "fix-json-custom") {
    return <AutofixModelMenu
      config={null}
      defaultModel="hf:syntheticlab/fix-json"
      modelNickname="fix-json"
      onOverrideDefaultApiKey={onOverrideDefaultApiKey}
      onComplete={(config) => {
        onComplete({
          diffApply: diffApplyConfig!,
          fixJson: config,
        });
      }}
      onCancel={() => setAutofixStep("diff-apply-custom")}
    >
      <Text>
        Octo uses tools to work with your underlying codebase. Some model providers don't support
        strict constraints on how tool calls are generated, and models can make mistakes generating
        JSON, the format used for all of Octo's tool calls.
      </Text>
      <Text>
        The fix-json model can automatically fix broken JSON for Octo, helping models avoid failures
        more quickly and cheaply than retrying the main model. It also may help reduce the main
        model's confusion.
      </Text>
    </AutofixModelMenu>
  }

  return <CenteredBox>
    <MenuHeader title="Optional: Enable autofix models" />

    <Box marginBottom={1} flexDirection="column" gap={1}>
      <Text>
        Before we set up your main coding model, we can optionally enable two small helper models
        that can significantly improve Octo's performance. These are small, fast models trained to
        auto-fix broken tool calls and diff edits from your main coding model, since even fairly
        good coding models can sometimes make mistakes.
      </Text>
      <Text>
        Auto-fixing mistakes can help reduce model confusion, since models are often
        less-well-trained on error recovery than they are at their happy paths.
      </Text>
    </Box>

    <SelectInput
      items={items}
      onSelect={onSelect}
      indicatorComponent={IndicatorComponent}
      itemComponent={ItemComponent}
    />
  </CenteredBox>
}

function AutofixCompleteScreen({ onContinue }: { onContinue: () => void }) {
  useInput((_, key) => {
    if(key.return) onContinue();
  });

  return <CenteredBox>
    <MenuHeader title="✨ Autofix models enabled!" />

    <Text>
      Your autofix models are now set up and ready to go. These will help improve Octo's performance
      by automatically fixing minor mistakes in code diffs and JSON tool calls.
    </Text>

    <Box marginTop={1}>
      <Text>
        Now let's set up your main coding model. This is the LLM that will power Octo's code
        generation, analysis, and conversation capabilities.
      </Text>
    </Box>

    <Box marginTop={2} justifyContent="center">
      <Text color={THEME_COLOR}>Press enter to continue to model setup.</Text>
    </Box>
  </CenteredBox>
}

function WelcomeScreen({ onContinue }: { onContinue: () => void }) {

  useInput((_, key) => {
    if(key.return) onContinue();
  });

  return <CenteredBox>
    <MenuHeader title="Welcome to Octo!" />

    <Text>
      You don't seem to have a config file, so let's set you up for the first time.
    </Text>

    <Box marginTop={1}>
      <Text>
        Octo lets you choose the LLM that powers it. Currently our recommended day-to-day coding
        model to use with Octo is either GPT-5, or Claude 4 Sonnet. If you want more data privacy,
        another great model is GLM-4.5, an open-source coding model you can use via Synthetic, a
        privacy-focused inference company (that we run!).
      </Text>
    </Box>

    <Box marginTop={1}>
      <Text color="gray">
        Be forewarned about using OpenRouter for open-source models: OpenRouter doesn't test model
        implementations, and quality can vary drastically. Many are broken.
        We'd strongly recommend using Synthetic instead.
      </Text>
    </Box>

    <Box marginTop={1}>
      <Text>
        You can add multiple models via Octo's menu: Octo lets you switch models mid-conversation as
        needed to handle different problems. It's often helpful to add a couple of strong models; if
        one gets stuck, another may often be able to solve your problem. Octo works with any OpenAI-
        or Anthropic-compatible API.
      </Text>
    </Box>

    <Box marginTop={2} justifyContent="center">
      <Text color={THEME_COLOR}>Press enter when you're ready to begin setup.</Text>
    </Box>
  </CenteredBox>
}
