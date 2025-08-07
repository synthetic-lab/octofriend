import React, { useState, useCallback, useReducer } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { IndicatorComponent, ItemComponent } from "./select.tsx";
import { MenuPanel, MenuHeader } from "./menu-panel.tsx";
import { Config } from "../config.ts";
import { AddModelFlow } from "./add-model-flow.tsx";
import { CenteredBox } from "./centered-box.tsx";
import { ProviderConfig, PROVIDERS, keyFromName } from "./providers.ts";
import { OverrideEnvVar } from "./override-env-var.tsx";
import { ConfirmDialog } from "./confirm-dialog.tsx";

export type AutoDetectModelsProps = {
  onComplete: (models: Config["models"]) => void,
  onCancel: () => void,
  onOverrideDefaultApiKey: (o: Record<string, string>) => any,
  config: Config | null,
  titleOverride?: string,
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

function getEnvVar(provider: ProviderConfig, config: Config | null, overrideEnvVar: string | null) {
  if(overrideEnvVar) return overrideEnvVar;
  const key = keyFromName(provider.name);
  if(config?.defaultApiKeyOverrides && config.defaultApiKeyOverrides[key]) {
    return config.defaultApiKeyOverrides[key];
  }
  return provider.envVar;
}

export function ModelSetup({
  config, onComplete, onCancel, onOverrideDefaultApiKey, titleOverride
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
        titleOverride={titleOverride}
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
        onImport={models => {
          onComplete(models.map(model => {
            let t = {};
            if(stepData.provider.type) t = { type: stepData.provider.type };
            return {
              ...model,
              nickname: `${model.nickname} (${stepData.provider.name})`,
              apiEnvVar: getEnvVar(stepData.provider, config, stepData.overrideEnvVar),
              baseUrl: stepData.provider.baseUrl,
              ...t,
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
        onComplete={model => {
          let modelClone = { ...model };
          if(stepData.provider.type) {
            modelClone.type = stepData.provider.type;
          }
          onComplete([ modelClone ])
        }}
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

function FastProviderList({ onChooseCustom, onChooseProvider, titleOverride }: {
  onChooseProvider: (provider: keyof typeof PROVIDERS) => any,
  onChooseCustom: () => any,
  titleOverride?: string,
}) {
  const providerItems = Object.entries(PROVIDERS).map(([ key, provider ]) => {
    const k = key as keyof typeof PROVIDERS;
    return {
      label: provider.name,
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

  return <MenuPanel
    title={titleOverride || "Choose a model provider:"}
    items={items}
    onSelect={onSelect}
  />
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
    label: "Import a custom model string...",
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
