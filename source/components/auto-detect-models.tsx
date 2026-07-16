import React, { useState, useCallback, useReducer } from "react";
import SelectInput from "./selection/select-input.tsx";
import { IndicatorComponent, ItemComponent } from "./select.tsx";
import { MenuHeader } from "./menu-panel.tsx";
import { Config, Auth } from "../config.ts";
import { FullAddModelFlow, CustomModelFlow, CustomAuthFlow } from "./add-model-flow.tsx";
import { CenteredBox } from "./centered-box.tsx";
import { ProviderConfig, PROVIDERS, keyFromName } from "../providers.ts";
import { KbShortcutPanel } from "./kb-select/kb-shortcut-panel.tsx";
import { Item, Keymap } from "./kb-select/kb-shortcut-select.tsx";
import { hasCodexOAuthTokens } from "../codex-oauth.ts";
import { Span } from "paintcannon-react";
import { useKeyboard } from "../hooks/use-keyboard.ts";
import { TerminalFlex } from "./terminal-flex.tsx";
export type AutoDetectModelsProps = {
  onComplete: (models: Config["models"]) => void;
  onCancel: () => void;
  onOverrideDefaultApiKey: (o: Record<string, string>) => Promise<any>;
  config: Config | null;
  titleOverride?: string;
};
type StepData =
  | {
      step: "initial";
    }
  | {
      step: "custom";
    }
  | {
      step: "found";
      provider: ProviderConfig;
      overrideAuth: Auth | null;
      useEnvVar: boolean;
    }
  | {
      step: "missing";
      provider: ProviderConfig;
    }
  | {
      step: "override-model-string";
      provider: ProviderConfig;
      overrideAuth: Auth | null;
      useEnvVar: boolean;
    };
function getEnvVar(provider: ProviderConfig, config: Config | null, overrideEnvVar: string | null) {
  if (overrideEnvVar) return overrideEnvVar;
  const key = keyFromName(provider.name);
  if (config?.defaultApiKeyOverrides && config.defaultApiKeyOverrides[key]) {
    return config.defaultApiKeyOverrides[key];
  }
  return provider.envVar;
}
export function ModelSetup({
  config,
  onComplete,
  onCancel,
  onOverrideDefaultApiKey,
  titleOverride,
}: AutoDetectModelsProps) {
  const [stepData, dispatch] = useReducer(reducer, {
    step: "initial",
  });
  useKeyboard(event => {
    if (event.key === "Escape") {
      if (stepData.step === "initial") onCancel();
      else if (stepData.step !== "custom") {
        // custom handles its own cancellation
        dispatch({
          force: true,
          to: {
            step: "initial",
          },
        });
      }
    }
  });
  const onChooseProvider = useCallback(
    async (providerKey: keyof typeof PROVIDERS) => {
      const provider: ProviderConfig = PROVIDERS[providerKey];
      if (provider.type === "codex") {
        if (await hasCodexOAuthTokens()) {
          return dispatch({
            from: "initial",
            to: {
              step: "found",
              provider,
              overrideAuth: {
                type: "codex",
              },
              useEnvVar: false,
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
      }
      const envVar = getEnvVar(provider, config, null);
      if (process.env[envVar]) {
        return dispatch({
          from: "initial",
          to: {
            step: "found",
            provider,
            overrideAuth: null,
            useEnvVar: true,
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
    },
    [config],
  );
  const onChooseCustom = useCallback(() => {
    dispatch({
      from: "initial",
      to: {
        step: "custom",
      },
    });
  }, []);
  switch (stepData.step) {
    case "initial":
      return (
        <FastProviderList
          onChooseCustom={onChooseCustom}
          onChooseProvider={onChooseProvider}
          onBack={onCancel}
          titleOverride={titleOverride}
        />
      );
    case "custom":
      return (
        <FullAddModelFlow
          config={config}
          onComplete={model => onComplete([model])}
          onCancel={() => {
            dispatch({
              from: "custom",
              to: {
                step: "initial",
              },
            });
          }}
        />
      );
    case "found":
      return (
        <ImportModelsFrom
          config={config}
          provider={stepData.provider}
          onImport={models => {
            onComplete(
              models.map(model => {
                if (stepData.provider.type === "codex") {
                  return {
                    ...model,
                    type: "codex",
                    nickname: `${model.nickname} (${stepData.provider.name})`,
                    auth: {
                      type: "codex",
                    },
                  };
                }
                const base: Config["models"][number] = {
                  ...model,
                  ...(stepData.provider.type
                    ? {
                        type: stepData.provider.type,
                      }
                    : {}),
                  nickname: `${model.nickname} (${stepData.provider.name})`,
                  baseUrl: stepData.provider.baseUrl,
                };
                if (
                  stepData.overrideAuth?.type === "env" ||
                  stepData.overrideAuth?.type === "command"
                ) {
                  base.auth = stepData.overrideAuth;
                } else if (stepData.useEnvVar) {
                  base.apiEnvVar = getEnvVar(stepData.provider, config, null);
                }
                return base;
              }),
            );
          }}
          onCancel={() => {
            dispatch({
              from: "found",
              to: {
                step: "initial",
              },
            });
          }}
          onCustomModel={() => {
            dispatch({
              from: "found",
              to: {
                step: "override-model-string",
                provider: stepData.provider,
                overrideAuth: stepData.overrideAuth,
                useEnvVar: stepData.useEnvVar,
              },
            });
          }}
        />
      );
    case "missing":
      return (
        <CustomAuthFlow
          config={config}
          authData={
            stepData.provider.type === "codex"
              ? {
                  modelType: "codex",
                }
              : {
                  modelType: stepData.provider.type,
                  baseUrl: stepData.provider.baseUrl,
                }
          }
          onComplete={async auth => {
            if (auth && auth.type === "env") {
              await onOverrideDefaultApiKey({
                [keyFromName(stepData.provider.name)]: auth.name,
              });
            }
            const overrideAuth: Auth | null =
              auth ||
              (stepData.provider.type === "codex"
                ? {
                    type: "codex",
                  }
                : null);
            dispatch({
              from: "missing",
              to: {
                step: "found",
                provider: stepData.provider,
                overrideAuth,
                useEnvVar: false,
              },
            });
          }}
          onCancel={() => {
            dispatch({
              from: "missing",
              to: {
                step: "initial",
              },
            });
          }}
        />
      );
    case "override-model-string":
      return (
        <CustomModelFlow
          config={config}
          onComplete={model => {
            if (stepData.provider.type === "codex") {
              onComplete([
                {
                  ...model,
                  type: "codex",
                  auth: {
                    type: "codex",
                  },
                },
              ]);
              return;
            }
            if (model.type === "codex") return;
            const apiModel = {
              nickname: model.nickname,
              baseUrl: model.baseUrl,
              model: model.model,
              context: model.context,
              ...(model.reasoning
                ? {
                    reasoning: model.reasoning,
                  }
                : {}),
              ...(model.modalities
                ? {
                    modalities: model.modalities,
                  }
                : {}),
              ...(model.auth?.type === "env" || model.auth?.type === "command"
                ? {
                    auth: model.auth,
                  }
                : {}),
            };
            if (
              stepData.provider.type === "standard" ||
              stepData.provider.type === "openai-responses" ||
              stepData.provider.type === "anthropic"
            ) {
              onComplete([
                {
                  ...apiModel,
                  type: stepData.provider.type,
                },
              ]);
              return;
            }
            onComplete([
              {
                ...apiModel,
              },
            ]);
          }}
          onCancel={() => {
            dispatch({
              from: "override-model-string",
              to: {
                step: "found",
                provider: stepData.provider,
                overrideAuth: stepData.overrideAuth,
                useEnvVar: stepData.useEnvVar,
              },
            });
          }}
          baseUrl={stepData.provider.baseUrl}
          auth={
            stepData.overrideAuth ||
            (stepData.useEnvVar
              ? {
                  type: "env",
                  name: stepData.provider.envVar,
                }
              : undefined)
          }
        />
      );
  }
}
function FastProviderList({
  onChooseCustom,
  onChooseProvider,
  onBack,
  titleOverride,
}: {
  onChooseProvider: (provider: keyof typeof PROVIDERS) => any;
  onChooseCustom: () => any;
  onBack: () => any;
  titleOverride?: string;
}) {
  const providerItems = Object.entries(PROVIDERS).map(([key, provider]) => {
    const k = key as keyof typeof PROVIDERS;
    return {
      label: provider.name,
      value: k,
      shortcut: provider.shortcut,
    };
  });
  const providerShortcuts: Keymap<keyof typeof PROVIDERS> = {};
  for (const item of providerItems) {
    providerShortcuts[item.shortcut] = {
      label: item.label,
      value: item.value,
    };
  }
  type ProviderValue = keyof typeof PROVIDERS | "custom" | "back";
  const items: Keymap<ProviderValue> = {
    ...providerShortcuts,
    c: {
      label: "Add a custom model...",
      value: "custom" as const,
    },
    b: {
      label: "Back",
      value: "back" as const,
    },
  };
  const onSelect = useCallback((item: Item<ProviderValue>) => {
    if (item.value === "custom") return onChooseCustom();
    if (item.value === "back") return onBack();
    onChooseProvider(item.value);
  }, []);
  return (
    <KbShortcutPanel
      title={titleOverride || "Choose a model provider:"}
      shortcutItems={[
        {
          type: "key" as const,
          mapping: items,
        },
      ]}
      onSelect={onSelect}
    />
  );
}
function ImportModelsFrom({
  config,
  provider,
  onImport,
  onCancel,
  onCustomModel,
}: {
  config: Config | null;
  provider: ProviderConfig;
  onImport: (m: ProviderConfig["models"]) => any;
  onCustomModel: () => any;
  onCancel: () => any;
}) {
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  let remainingModels: ProviderConfig["models"] = [];
  const importedModels: ProviderConfig["models"] = [];
  if (config == null) {
    remainingModels = provider.models;
  } else {
    for (const model of provider.models) {
      let found = false;
      for (const storedModel of config.models) {
        if (
          storedModel.model === model.model &&
          (storedModel.type === "codex"
            ? provider.type === "codex"
            : storedModel.baseUrl === provider.baseUrl)
        ) {
          importedModels.push(model);
          found = true;
          break;
        }
      }
      if (!found) remainingModels.push(model);
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
  if (selectedModels.length > 0) {
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
    label: "Back",
    value: "back" as const,
  });
  const onSelect = useCallback(
    (item: (typeof items)[number]) => {
      if (item.value === "custom") return onCustomModel();
      if (item.value === "back") return onCancel();
      if (item.value === "import") {
        const models = provider.models.filter(m => {
          return selectedModels.includes(m.nickname);
        });
        onImport(models);
        return;
      }
      const nickname = item.value;
      if (!selectedModels.includes(nickname)) {
        setSelectedModels([...selectedModels, nickname]);
      } else {
        setSelectedModels(selectedModels.filter(m => m !== nickname));
      }
    },
    [selectedModels],
  );
  if (remainingModels.length === 0) {
    return (
      <CenteredBox>
        <KbShortcutPanel
          title={`You already imported all our recommended models from ${provider.name}!`}
          shortcutItems={[
            {
              type: "key" as const,
              mapping: {
                c: {
                  label: `Add a custom model string from ${provider.name}`,
                  value: "custom" as const,
                },
                b: {
                  label: "Back",
                  value: "back" as const,
                },
              },
            },
          ]}
          onSelect={item => {
            if (item.value === "custom") return onCustomModel();
            return onCancel();
          }}
        />
      </CenteredBox>
    );
  }
  return (
    <CenteredBox>
      <MenuHeader title={`${provider.name} models can be imported!`} />

      <TerminalFlex
        style={{
          marginBottom: 1,
        }}
      >
        <Span>Which of the following models would you like to import?</Span>
      </TerminalFlex>

      <SelectInput
        items={items}
        onSelect={onSelect}
        indicatorComponent={IndicatorComponent}
        itemComponent={ItemComponent}
      />
    </CenteredBox>
  );
}

// Tracks what state fired the state transition, so that if it's an outdated state (i.e. it's from
// an async promise resolving), it won't make the state transition
function reducer(
  state: StepData,
  action:
    | {
        from: StepData["step"];
        to: StepData;
      }
    | {
        force: true;
        to: StepData;
      },
) {
  if ("force" in action) return action.to;
  if (state.step === action.from) return action.to;
  return state;
}
