import React, { useState, useCallback, useEffect } from "react";
import { t } from "structural";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { Config } from "../config.ts";
import { useColor } from "../theme.ts";
import OpenAI from "openai";
import { trackTokens } from "../token-tracker.ts";

type ModelVar = keyof (Config["models"][number]);
type ValidationResult = { valid: true } | { valid: false, error: string };

type AddModelStep<T extends ModelVar> = {
  title: string;
  prompt: string;
  varname: T;
  parse: (val: string) => Config["models"][number][T];
  validate: (val: string) => ValidationResult;
  description: (props: { renderExamples: boolean }) => React.ReactNode;
};

const MinConnectArgsSchema = t.subtype({
  model: t.str,
  apiEnvVar: t.str,
  baseUrl: t.str,
});
type MinConnectArgs = t.GetType<typeof MinConnectArgsSchema>;

const MODEL_STEPS = [
  {
    title: "What's the base URL for the API you're connecting to?",
    prompt: "Base URL:",
    varname: "baseUrl" as const,
    parse(val: string) {
      return val;
    },
    validate: () => ({ valid: true }),
    description(_) {
      return <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text>
            (For example, for Moonshot's Kimi K2 API, https://api.moonshot.ai/v1)
          </Text>
        </Box>
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
    description(_) {
      return <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text>
            (For example, MOONSHOT_API_KEY)
          </Text>
        </Box>
        <Text>
          You can typically find your API key on your account or settings page on your
          inference provider's website.
        </Text>
        <Text>
          After getting an API key, make sure to export it in your shell; for example:
        </Text>
        <Text bold>
          export MOONSHOT_API_KEY="your-api-key-here"
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
    description({ renderExamples }) {
      return <Box flexDirection="column">
        {
          renderExamples && <Box marginBottom={1}>
            <Text>
              (For example, to use Kimi K2 with the Moonshot API, you would use kimi-k2-0711-preview)
            </Text>
          </Box>
        }
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
    description({ renderExamples }) {
      return <Box flexDirection="column">
        {
          renderExamples && <Text>
            For example, if this was set up to talk to Kimi K2, you might want to call it that.
          </Text>
        }
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
    description(_) {
      const color = useColor();
      return <Box flexDirection="column">
        <Text>
          You can usually find this information in the documentation for the model on your inference
          company's website.
        </Text>
        <Box marginY={1}>
          <Text>
            (This is an estimate: leave some buffer room. Best performance is often at half the
            number of tokens supported by the API.)
          </Text>
        </Box>
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
function _assertCovered(x: Exclude<ModelVar, "reasoning">) {
  checkCovered(x);
}

export type AddModelFlowProps = {
  onComplete: (model: Config["models"][number]) => void;
  onCancel: () => void;
  startingStep?: {
    modelProgress: Partial<Config["models"][number]>,
    stepVar: ModelVar,
  },
  skipExamples?: boolean
};

type TestConnectionState = {
  testing: false,
} | {
  testing: true,
  args: MinConnectArgs,
};
export function AddModelFlow({ onComplete, onCancel, startingStep, skipExamples }: AddModelFlowProps) {
  const renderExamples = !skipExamples;
  const [ testingConnection, setTestingConnection ] = useState<TestConnectionState>({
    testing: false,
  });
  const [ errorMessage, setErrorMessage ] = useState<null | string>(null);
  const [ modelProgress, setModelProgress ] = useState<Partial<Config["models"][number]>>(
    startingStep?.modelProgress || {}
  );
  const [ stepVar, setStepVar ] = useState<ModelVar>(
    startingStep?.stepVar || MODEL_STEPS[0].varname
  );
  const [ varValue, setVarValue ] = useState("");
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
    const newModelProgress = {
      ...modelProgress,
      [currentStep.varname]: parsed,
    };

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

      const args = MinConnectArgsSchema.slice(newModelProgress);
      setTestingConnection({
        testing: true,
        args,
      });
    }

    setModelProgress(newModelProgress);
    setVarValue("");

    const index = MODEL_STEPS.indexOf(currentStep);
    if (index < MODEL_STEPS.length - 1) setStepVar(MODEL_STEPS[index + 1].varname);
    else onComplete(newModelProgress as Config["models"][number]);
  }, [ currentStep, MODEL_STEPS, varValue, modelProgress, onComplete ]);

  const themeColor = useColor();

  useInput((_, key) => {
    if(key.escape) {
      if(currentStep.varname === startingStep?.stepVar) {
        onCancel();
        return;
      }

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

  if(testingConnection.testing) {
    return <TestConnection
      {...testingConnection.args}
      onError={() => {
        setTestingConnection({ testing: false });
        setStepVar(startingStep?.stepVar || MODEL_STEPS[0].varname);
        setErrorMessage("Connection failed.");
      }}
      onSuccess={() => {
        setTestingConnection({ testing: false });
      }}
    />
  }

  return <Box flexDirection="column" justifyContent="center" alignItems="center" marginTop={1}>
    <Box flexDirection="column" width={80} gap={1}>
      <Text color={themeColor}>{ currentStep.title }</Text>
      <currentStep.description renderExamples={renderExamples} />
    </Box>

    <Box marginY={1} width={80}>
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

function TestConnection({ model, apiEnvVar, baseUrl, onError, onSuccess }: MinConnectArgs & {
  onError: () => any,
  onSuccess: () => any,
}) {
  useEffect(() => {
    testConnection({ model, apiEnvVar, baseUrl }).then(valid => {
      if(valid) onSuccess();
      else onError();
    });
  }, [ model, apiEnvVar, baseUrl, onError, onSuccess ]);

  return <Box flexDirection="column" justifyContent="center" alignItems="center" marginTop={1}>
    <Box flexDirection="column" width={80}>
      <Text color="yellow" bold>Testing connection...</Text>
    </Box>
  </Box>
}

async function testConnection({ model, apiEnvVar, baseUrl }: MinConnectArgs) {
  try {
    const client = new OpenAI({
      baseURL: baseUrl,
      apiKey: process.env[apiEnvVar],
    });

    const response = await client.chat.completions.create({
      model,
      messages: [{
        role: "user",
        content: "Respond with the word 'hi' and only the word 'hi'",
      }],
    });
    if(response.usage) {
      trackTokens(model, "input", response.usage.prompt_tokens);
      trackTokens(model, "output", response.usage.completion_tokens);
    }
    return true;
  } catch(e) {
    return false;
  }
}
