import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { Config } from "../config.ts";
import { useColor } from "../theme.ts";

type ModelVar = keyof (Config["models"][number]);
type ValidationResult = { valid: true } | { valid: false, error: string };

type AddModelStep<T extends ModelVar> = {
  title: string;
  prompt: string;
  varname: T;
  parse: (val: string) => Config["models"][number][T];
  validate: (val: string) => ValidationResult;
  description: () => React.ReactNode;
};

const MODEL_STEPS = [
  {
    title: "What's the base URL for the API you're connecting to?",
    prompt: "Base URL:",
    varname: "baseUrl" as const,
    parse(val: string) {
      return val;
    },
    validate: () => ({ valid: true }),
    description() {
      return <Box flexDirection="column">
        <Text>
          (For example, https://api.synthetic.new/v1)
        </Text>
        <Text>
          You can usually find this information in your inference provider's documentation.
        </Text>
      </Box>
    },
  } satisfies AddModelStep<"baseUrl">,
  {
    title: "What environment variable should Octo read to get the API key?",
    prompt: "Environment variable name:",
    varname: "apiEnvVar" as const,
    parse(val: string) {
      return val;
    },
    validate(val: string) {
      if(process.env[val]) return { valid: true };
      return {
        valid: false,
        error: `
Env var ${val} isn't defined in your current shell. Do you need to re-source your .bashrc or .zshrc?
        `.trim(),
      };
    },
    description() {
      return <Box flexDirection="column">
        <Text>
          (For example, SYNTHETIC_API_KEY)
        </Text>
        <Text>
          You can typically find your API key on your account or settings page on your
          inference provider's website.
        </Text>
        <Text>
          For Synthetic, go to: https://synthetic.new/user-settings/api
        </Text>
        <Text>
          After getting an API key, make sure to export it in your shell; for example:
        </Text>
        <Text bold>
          export SYNTHETIC_API_KEY="your-api-key-here"
        </Text>
        <Text>
          (If you're running a local LLM, you can use any non-empty env var.)
        </Text>
      </Box>
    },
  } satisfies AddModelStep<"apiEnvVar">,
  {
    title: "What's the model string for the API you're using?",
    prompt: "Model string:",
    varname: "model" as const,
    parse(val: string) {
      return val;
    },
    validate: () => ({ valid: true }),
    description() {
      return <Box flexDirection="column">
        <Text>
          (For example, with Synthetic, you could use hf:deepseek-ai/DeepSeek-R1-0528)
        </Text>
        <Text>
          This varies by inference provider: you can typically find this information in your
          inference provider's documentation.
        </Text>
      </Box>
    },
  } satisfies AddModelStep<"model">,
  {
    title: "Let's give this model a nickname so we can easily reference it later.",
    prompt: "Nickname:",
    varname: "nickname" as const,
    parse(val: string) {
      return val;
    },
    validate: () => ({ valid: true }),
    description() {
      return <Box flexDirection="column">
        <Text>
          For example, if this was set up to talk to DeepSeek-V3-0324, you might want to call it
          that.
        </Text>
      </Box>
    },
  } satisfies AddModelStep<"nickname">,
  {
    title: "What's the maximum number of tokens Octo should use per request?",
    prompt: "Maximum tokens:",
    varname: "context" as const,
    parse(val: string) {
      return parseInt(val.replace("k", ""), 10) * 1024;
    },
    validate(value: string) {
      if(value.replace("k", "").match(/^\d+$/)) return { valid: true };
      return {
        valid: false,
        error: "Couldn't parse your input as a number: please try again",
      };
    },
    description() {
      const color = useColor();
      return <Box flexDirection="column">
        <Text>
          You can usually find this information in the documentation for the model on your inference
          company's website.
        </Text>
        <Text>
          (This is an estimate: leave some buffer room. Best performance is often at half the number
          of tokens supported by the API.)
        </Text>
        <Text>
          Format the number in k: for example,
          { " " }
          <Text color={color}>32k</Text>
          { " " }
          or,
          { " " }
          <Text color={color}>64k</Text>.
        </Text>
      </Box>
    },
  } satisfies AddModelStep<"context">,
];

// Assert all model variables have defined steps. This will cause compiler errors if not all steps
// are defined
type DefinedVarnames = (typeof MODEL_STEPS)[number]["varname"];
function checkCovered(_: DefinedVarnames) {}
function _assertCovered(x: ModelVar) {
  checkCovered(x);
}

export type AddModelFlowProps = {
  onComplete: (model: Config["models"][number]) => void;
  onCancel: () => void;
};

export function AddModelFlow({ onComplete, onCancel }: AddModelFlowProps) {
  const [errorMessage, setErrorMessage] = useState<null | string>(null);
  const [modelProgress, setModelProgress] = useState<Partial<Config["models"][number]>>({});
  const [stepVar, setStepVar] = useState<ModelVar>(MODEL_STEPS[0].varname);
  const [varValue, setVarValue] = useState<string>("");
  const currentStep = MODEL_STEPS.find(step => step.varname === stepVar)!;

  const onValueChange = useCallback((value: string) => {
    setErrorMessage("");
    setVarValue(value);
  }, [ currentStep ]);

  const onSubmit = useCallback(() => {
    const trimmed = varValue.trim();
    const validationResult = currentStep.validate(trimmed);
    if (!validationResult.valid) {
      setVarValue("");
      setErrorMessage(validationResult.error);
      return;
    }

    let parsed = currentStep.parse(trimmed);
    if (currentStep.varname === "model") {
      if (modelProgress["baseUrl"] === "https://api.synthetic.new/v1") {
        if (!(parsed as string).startsWith("hf:")) {
          setVarValue("");
          setErrorMessage(`
Synthetic model names need to be prefixed with "hf:" (without the quotes)
          `.trim());
          return;
        }
      }
    }

    const newModelProgress = {
      ...modelProgress,
      [currentStep.varname]: parsed,
    };
    setModelProgress(newModelProgress);
    setVarValue("");

    const index = MODEL_STEPS.indexOf(currentStep);
    if (index < MODEL_STEPS.length - 1) setStepVar(MODEL_STEPS[index + 1].varname);
    else onComplete(newModelProgress as Config["models"][number]);
  }, [ currentStep, MODEL_STEPS, varValue, modelProgress, onComplete ]);

  const themeColor = useColor();

  useInput((_, key) => {
    if(key.escape) {
      const index = MODEL_STEPS.indexOf(currentStep);
      if(index <= 0) {
        onCancel();
      }
      else {
        setVarValue("");
        setStepVar(MODEL_STEPS[index - 1].varname);
      }
    }
  });

  return <Box flexDirection="column" justifyContent="center" alignItems="center" marginTop={1}>
    <Box flexDirection="column" width={80}>
      <Text color={themeColor}>{ currentStep.title }</Text>
      <currentStep.description />
    </Box>

    <Box marginTop={1} width={80}>
      <Box marginRight={1}>
        <Text>{currentStep.prompt}</Text>
      </Box>

      <TextInput value={varValue} onChange={onValueChange} onSubmit={onSubmit} />
    </Box>

    {
      errorMessage && <Box width={80}>
        <Text color="red" bold>{ errorMessage }</Text>
      </Box>
    }
  </Box>
}

