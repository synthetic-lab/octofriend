import React, { useState, useCallback, useReducer } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import { IndicatorComponent, ItemComponent } from "./select.tsx";
import { MenuPanel, MenuHeader } from "./menu-panel.tsx";
import { Config } from "../config.ts";
import { AddModelFlow } from "./add-model-flow.tsx";
import { CenteredBox } from "./centered-box.tsx";
import { useColor } from "../theme.ts";

export type AutoDetectModelsProps = {
  onComplete: (models: Config["models"]) => void,
  onCancel: () => void,
  onOverrideDefaultApiKey: (o: Record<string, string>) => any,
  config: Config | null,
};

type ProviderConfig = {
  name: string,
  envVar: string,
  baseUrl: string,
  models: Array<{
    model: string,
    nickname: string,
    context: number,
  }>;
  testModel: string,
};

const PROVIDERS = {
  synthetic: {
    name: "Synthetic",
    envVar: "SYNTHETIC_API_KEY",
    baseUrl: "https://api.synthetic.new/v1",
    models: [
      {
        model: "hf:moonshotai/Kimi-K2-Instruct",
        nickname: "Kimi K2",
        context: 64 * 1024,
      },
      {
        model: "hf:Qwen/Qwen3-235B-A22B-Instruct-2507",
        nickname: "Qwen3 235B-A22B-Instruct-2507",
        context: 64 * 1024,
      },
      {
        model: "hf:deepseek-ai/DeepSeek-R1-0528",
        nickname: "DeepSeek R1-0528",
        context: 64 * 1024,
      },
    ],
    testModel: "hf:moonshotai/Kimi-K2-Instruct",
  } satisfies ProviderConfig,

  openai: {
    name: "OpenAI",
    envVar: "OPENAI_API_KEY",
    baseUrl: "https://api.openai.com/v1",
    models: [
      { model: "gpt-4.1-latest", nickname: "GPT-4.1", context: 64 * 1024 },
      { model: "o3-latest", nickname: "o3", context: 128 * 1024 },
    ],
    testModel: "gpt-4.1-latest",
  } satisfies ProviderConfig,

  moonshot: {
    name: "Moonshot",
    envVar: "MOONSHOT_API_KEY",
    baseUrl: "https://api.moonshot.ai/v1",
    models: [
      { model: "kimi-k2-0711-preview", nickname: "Kimi K2", context: 64 * 1024 },
    ],
    testModel: "kimi-k2-0711-preview",
  } satisfies ProviderConfig,

  grok: {
    name: "xAI",
    envVar: "XAI_API_KEY",
    baseUrl: "https://api.x.ai/v1",
    models: [
      { model: "grok-4-latest", nickname: "Grok 4", context: 64 * 1024 },
    ],
    testModel: "grok-4-latest",
  } satisfies ProviderConfig,
};

type StepData = {
  step: "initial"
} | {
  step: "custom",
} | {
  step: "override-env-var",
  provider: ProviderConfig,
} | {
  step: "found",
  provider: ProviderConfig,
  overrideEnvVar: string | null,
} | {
  step: "missing",
  provider: ProviderConfig,
} | {
  step: "override-model-string",
  provider: ProviderConfig,
  overrideEnvVar: string | null,
};

function keyFromName(name: string): keyof typeof PROVIDERS {
  for(const [key, value] of Object.entries(PROVIDERS)) {
    if(value.name === name) return key as keyof typeof PROVIDERS;
  }
  throw new Error(`No provider named ${name} found`);
}

function getEnvVar(provider: ProviderConfig, config: Config | null, overrideEnvVar: string | null) {
  if(overrideEnvVar) return overrideEnvVar;
  const key = keyFromName(provider.name);
  if(config?.defaultApiKeyOverrides && config.defaultApiKeyOverrides[key]) {
    return config.defaultApiKeyOverrides[key];
  }
  return provider.envVar;
}

export function ModelSetup({
  config, onComplete, onCancel, onOverrideDefaultApiKey
}: AutoDetectModelsProps) {
  const [ stepData, dispatch ] = useReducer(reducer, { step: "initial" });

  useInput((_, key) => {
    if(key.escape) {
      if(stepData.step === "initial") onCancel();
      else dispatch({ force: true, to: { step: "initial" } });
    }
  });

  const onChooseProvider = useCallback((providerKey: keyof typeof PROVIDERS) => {
    const provider = PROVIDERS[providerKey];
    const envVar = getEnvVar(provider, config, null);
    if(process.env[envVar]) {
      return dispatch({
        from: "initial",
        to: {
          step: "found",
          provider,
          overrideEnvVar: null,
        },
      });
    }
    return dispatch({
      from: "initial",
      to: {
        step: "missing",
        provider,
      },
    });
  }, [ config ]);

  const onChooseCustom = useCallback(() => {
    dispatch({ from: "initial", to: { step: "custom" } });
  }, []);

  switch(stepData.step) {
    case "initial":
      return <FastProviderList
        onChooseCustom={onChooseCustom}
        onChooseProvider={onChooseProvider}
      />

    case "custom":
      return <AddModelFlow onComplete={(model) => onComplete([ model ])} onCancel={() => {
        dispatch({
          from: "custom",
          to: { step: "initial" },
        });
      }} />

    case "found":
      return <ImportModelsFrom
        config={config}
        provider={stepData.provider}
        onImport={(models) => {
          onComplete(models.map(model => {
            return {
              ...model,
              nickname: `${model.nickname} (${stepData.provider.name})`,
              apiEnvVar: getEnvVar(stepData.provider, config, stepData.overrideEnvVar),
              baseUrl: stepData.provider.baseUrl,
            };
          }));
        }}
        onCancel={() => {
          dispatch({ from: "found", to: { step: "initial" } });
        }}
        onCustomModel={() => {
          dispatch({ from: "found", to: {
            step: "override-model-string",
            provider: stepData.provider,
            overrideEnvVar: stepData.overrideEnvVar,
          } });
        }}
      />

    case "missing":
      return <MissingEnvVar
        provider={stepData.provider}
        config={config}
        onShouldOverride={() => {
          dispatch({
            from: "missing",
            to: {
              step: "override-env-var",
              provider: stepData.provider,
            },
          });
        }}
        onCancel={() => {
          dispatch({ from: "missing", to: { step: "initial" } });
        }}
      />

    case "override-env-var":
      return <OverrideEnvVar
        provider={stepData.provider}
        onSubmit={envVar => {
          onOverrideDefaultApiKey({
            [keyFromName(stepData.provider.name)]: envVar,
          });

          dispatch({
            from: "override-env-var",
            to: {
              step: "found",
              provider: stepData.provider,
              overrideEnvVar: envVar,
            },
          });
        }}
      />

    case "override-model-string":
      return <AddModelFlow
        onComplete={model => onComplete([ model ])}
        onCancel={() => {
          dispatch({
            from: "override-model-string",
            to: {
              step: "found",
              provider: stepData.provider,
              overrideEnvVar: stepData.overrideEnvVar,
            },
          });
        }}
        startingStep={{
          stepVar: "model",
          modelProgress: {
            baseUrl: stepData.provider.baseUrl,
            apiEnvVar: getEnvVar(stepData.provider, config, stepData.overrideEnvVar),
          },
        }}
        skipExamples
      />
  }
}

function FastProviderList({ onChooseCustom, onChooseProvider }: {
  onChooseProvider: (provider: keyof typeof PROVIDERS) => any,
  onChooseCustom: () => any,
}) {
  const providerItems = Object.entries(PROVIDERS).map(([ key, provider ]) => {
    const k = key as keyof typeof PROVIDERS;
    return {
      label: k === "synthetic" ? provider.name + " (recommended)" : provider.name,
      value: k,
    };
  });
  const items = [
    ...providerItems,
    {
      label: "Add a custom model...",
      value: "custom" as const,
    },
  ]

  const onSelect = useCallback((item: (typeof items)[number]) => {
    if(item.value === "custom") return onChooseCustom();
    onChooseProvider(item.value);
  }, []);

  return <MenuPanel title="Choose a model provider:" items={items} onSelect={onSelect} />
}

function ImportModelsFrom({ config, provider, onImport, onCancel, onCustomModel }: {
  config: Config | null,
  provider: ProviderConfig,
  onImport: (m: ProviderConfig["models"]) => any,
  onCustomModel: () => any,
  onCancel: () => any,
}) {
  const [ selectedModels, setSelectedModels ] = useState<string[]>([]);
  let remainingModels: ProviderConfig["models"] = [];
  const importedModels: ProviderConfig["models"] = [];

  if(config == null) {
    remainingModels = provider.models;
  }
  else {
    for(const model of provider.models) {
      let found = false;
      for(const storedModel of config.models) {
        if(storedModel.baseUrl === provider.baseUrl && storedModel.model === model.model) {
          importedModels.push(model);
          found = true;
          break;
        }
      }
      if(!found) remainingModels.push(model);
    }
  }

  const items = remainingModels.map(model => {
    const isSelected = selectedModels.includes(model.nickname);
    const label = isSelected ? `⦿ ${model.nickname}` : `○ ${model.nickname}`;
    return {
      label,
      value: model.nickname,
    };
  });

  if(selectedModels.length > 0) {
    items.push({
      label: "Import selected models",
      value: "import" as const,
    });
  }
  items.push({
    label: "Add a custom model string...",
    value: "custom" as const,
  });
  items.push({
    label: "Cancel",
    value: "cancel" as const,
  });

  const onSelect = useCallback((item: (typeof items)[number]) => {
    if(item.value === "custom") return onCustomModel();
    if(item.value === "cancel") return onCancel();
    if(item.value === "import") {
      const models = provider.models.filter(m => {
        return selectedModels.includes(m.nickname);
      });
      onImport(models);
      return;
    }
    const nickname = item.value;
    if(!selectedModels.includes(nickname)) {
      setSelectedModels([
        ...selectedModels,
        nickname,
      ]);
    }
    else {
      setSelectedModels(selectedModels.filter(m => m !== nickname));
    }
  }, [ selectedModels ]);

  if(remainingModels.length === 0) {
    return <CenteredBox>
      <MenuHeader title={`You already imported all our recommended models from ${provider.name}!`} />
      <ConfirmDialog
        confirmLabel={`Add a custom model string from ${provider.name}`}
        rejectLabel="Go back"
        onConfirm={onCustomModel}
        onReject={onCancel}
      />
    </CenteredBox>
  }

  return <CenteredBox>
    <MenuHeader title={`${provider.name} models can be imported!`} />

    <Box marginBottom={1}>
      <Text>
        Which of the following models would you like to import?
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

function MissingEnvVar({ provider, config, onShouldOverride, onCancel }: {
  provider: ProviderConfig,
  config: Config | null,
  onShouldOverride: () => any,
  onCancel: () => any,
}) {
  const envVar = getEnvVar(provider, config, null);
  return <CenteredBox>
    <MenuHeader title="Default API key is missing" />

    <Text>
      It looks like the default environment variable for {provider.name} — {envVar} — isn't
      exported in your current shell.
    </Text>

    <Box marginY={1}>
      <Text>
        (Hint: do you need to re-source your .bash_profile or .zshrc?)
      </Text>
    </Box>

    <ConfirmDialog
      confirmLabel={`I use a different environment variable for ${provider.name}`}
      rejectLabel="Go back"
      onConfirm={onShouldOverride}
      onReject={onCancel}
    />
  </CenteredBox>
}

function ConfirmDialog({ confirmLabel, rejectLabel, onConfirm, onReject }: {
  confirmLabel: string,
  rejectLabel: string,
  onConfirm: () => any,
  onReject: () => any,
}) {
  const items = [
    {
      label: confirmLabel,
      value: "confirm" as const,
    },
    {
      label: rejectLabel,
      value: "reject" as const,
    },
  ];
  const onSelect = useCallback((item: (typeof items)[number]) => {
    if(item.value === "confirm") return onConfirm();
    return onReject();
  }, []);

  return <Box justifyContent="center">
    <SelectInput
      items={items}
      onSelect={onSelect}
      indicatorComponent={IndicatorComponent}
      itemComponent={ItemComponent}
    />
  </Box>
}

function OverrideEnvVar({ provider, onSubmit }: {
  provider: ProviderConfig,
  onSubmit: (val: string) => any,
}) {
  const [ inputVal, setInputVal ] = useState("");
  const [ missing, setMissing ] = useState<string | null>(null);
  const themeColor = useColor();

  const handleSubmit = useCallback((val: string) => {
    if(process.env[val]) onSubmit(val);
    else {
      setInputVal("");
      setMissing(val);
    }
  }, []);

  const onChange = useCallback((val: string) => {
    setMissing(null);
    setInputVal(val);
  }, []);

  return <CenteredBox>
    <MenuHeader title="API key" />

    <Box flexDirection="column">
      <Text>
        What environment variable do you use for {provider.name}'s API key?
      </Text>
      <Box borderColor={themeColor} borderStyle={"round"} gap={1}>
        <TextInput value={inputVal} onChange={onChange} onSubmit={handleSubmit} />
      </Box>
      {
        missing && <Box flexDirection="column">
          <Text color="red">
            It looks like the {missing} env var isn't exported in your current shell.
          </Text>
          <Text color="gray">
            (Hint: do you need to re-source your .bash_profile or zshrc?)
          </Text>
        </Box>
      }
    </Box>
  </CenteredBox>
}

// Tracks what state fired the state transition, so that if it's an outdated state (i.e. it's from
// an async promise resolving), it won't make the state transition
function reducer(state: StepData, action: {
  from: StepData["step"],
  to: StepData,
} | {
  force: true,
  to: StepData,
}) {
  if("force" in action) return action.to;

  if(state.step === action.from) return action.to;
  return state;
}
