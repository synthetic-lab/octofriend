import React, { useState, useCallback, useReducer } from "react";
import { Config, Auth } from "../config.ts";
import { FullAddModelFlow, CustomModelFlow, CustomAuthFlow } from "./add-model-flow.tsx";
import { CenteredBox } from "./centered-box.tsx";
import { ProviderConfig, PROVIDERS, keyFromName, SYNTHETIC_PROVIDER } from "../providers.ts";
import { KbShortcutPanel, MenuHeader } from "./kb-select/kb-shortcut-panel.tsx";
import { Item, Keymap, ShortcutArray } from "./kb-select/kb-shortcut-select.tsx";
import { hasCodexOAuthTokens } from "../codex-oauth.ts";
import { Span } from "paintcannon-react";
import { useKeyboard } from "../hooks/use-keyboard.ts";
import { TerminalFlex } from "./terminal-flex.tsx";
import type { SyntheticModel } from "../synthetic-models.ts";
export type AutoDetectModelsProps = {
  syntheticModels: SyntheticModel[];
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
  syntheticModels,
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
            step:
              provider === SYNTHETIC_PROVIDER && syntheticModels.length === 0
                ? "override-model-string"
                : "found",
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
    [config, syntheticModels],
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
          syntheticModels={syntheticModels}
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
                step:
                  stepData.provider === SYNTHETIC_PROVIDER && syntheticModels.length === 0
                    ? "override-model-string"
                    : "found",
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
  const actions: Keymap<ProviderValue> = {
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
      header={titleOverride || "Choose a model provider:"}
      shortcutItems={[
        {
          type: "key" as const,
          mapping: providerShortcuts,
        },
      ]}
      actions={actions}
      onSelect={onSelect}
    />
  );
}
type ImportModelsProps = {
  config: Config | null;
  provider: ProviderConfig;
  onImport: (models: ProviderConfig["models"]) => any;
  onCustomModel: () => any;
  onCancel: () => any;
};

function ImportModelsFrom({
  syntheticModels,
  ...props
}: ImportModelsProps & { syntheticModels: SyntheticModel[] }) {
  if (props.provider !== SYNTHETIC_PROVIDER)
    return <ModelChecklist {...props} models={props.provider.models} />;
  const seenModels = new Set<string>();
  const models = syntheticModels.flatMap(({ huggingFaceId, ...model }) => {
    if (seenModels.has(huggingFaceId)) return [];
    seenModels.add(huggingFaceId);
    return [model];
  });
  return <ModelChecklist {...props} models={models} />;
}

function ModelChecklist({
  config,
  provider,
  models,
  onImport,
  onCancel,
  onCustomModel,
}: ImportModelsProps & {
  models: (ProviderConfig["models"][number] & {
    aliasOf?: string;
    categories?: string[];
  })[];
}) {
  const remainingModels = models.filter(
    model =>
      !config?.models.some(
        storedModel =>
          storedModel.model === model.model &&
          (storedModel.type === "codex"
            ? provider.type === "codex"
            : storedModel.baseUrl === provider.baseUrl),
      ),
  );
  const [selectedModels, setSelectedModels] = useState<Set<string>>(() => new Set());
  type Selection = { type: "model"; id: string } | { type: "import" | "custom" | "back" };
  const isSynthetic = provider === SYNTHETIC_PROVIDER;
  const items: Item<{ type: "model"; id: string }>[] = remainingModels.map(model => {
    const selected = selectedModels.has(model.model) ? "⦿" : "○";
    const detail = model.aliasOf ? ` (${model.aliasOf})` : "";
    return {
      label: (
        <>
          {selected} {model.nickname}
          {detail && <Span style={{ color: "gray" }}>{detail}</Span>}
        </>
      ),
      value: { type: "model", id: model.model },
    };
  });
  const recommendedSlugs = new Set(
    remainingModels
      .filter(model => model.categories?.includes("recommended"))
      .map(model => model.model),
  );
  const recommendedItems = items.filter(item => recommendedSlugs.has(item.value.id));
  const otherItems = items.filter(item => !recommendedSlugs.has(item.value.id));
  const shortcutItems: ShortcutArray<Selection> =
    isSynthetic && recommendedItems.length > 0 && otherItems.length > 0
      ? [
          {
            type: "sections",
            sections: [
              { id: "recommended", title: "Recommended", order: recommendedItems },
              { id: "other-models", title: "Other models", order: otherItems },
            ],
          },
        ]
      : [{ type: "auto-list", order: items }];
  const actions: Keymap<Selection> = {
    ...(isSynthetic
      ? {}
      : { c: { label: "Import a custom model string…", value: { type: "custom" } } }),
    b: { label: "Back", value: { type: "back" } },
    ...(selectedModels.size > 0
      ? {
          i: {
            label: (
              <Span style={{ fontWeight: "bold" }}>
                {selectedModels.size === 1
                  ? "Import selected model"
                  : `Import ${selectedModels.size} selected models`}
              </Span>
            ),
            spaceAbove: 1,
            value: { type: "import" as const },
          },
        }
      : {}),
  };
  return (
    <CenteredBox>
      <KbShortcutPanel<Selection>
        header={
          <>
            <MenuHeader title={`${provider.name}: choose models`} />
            <TerminalFlex style={{ flexDirection: "column", flexShrink: 0, marginBottom: 1 }}>
              <Span>
                {remainingModels.length === 0
                  ? "All models in this catalog have already been imported."
                  : "Toggle models with their number, then press i to import your selection."}
              </Span>
            </TerminalFlex>
          </>
        }
        shortcutItems={shortcutItems}
        actions={actions}
        onSelect={({ value }) => {
          switch (value.type) {
            case "custom":
              return onCustomModel();
            case "back":
              return onCancel();
            case "import":
              return onImport(
                remainingModels
                  .filter(model => selectedModels.has(model.model))
                  .map(({ aliasOf, categories, ...model }) => model),
              );
            case "model":
              setSelectedModels(previous => {
                const selected = new Set(previous);
                if (selected.has(value.id)) selected.delete(value.id);
                else selected.add(value.id);
                return selected;
              });
          }
        }}
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
