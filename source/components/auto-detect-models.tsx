import React, { useState, useCallback, useReducer, useEffect } from "react";
import { Config, Auth } from "../config.ts";
import { FullAddModelFlow, CustomModelFlow, CustomAuthFlow } from "./add-model-flow.tsx";
import { CenteredBox } from "./centered-box.tsx";
import { ProviderConfig, PROVIDERS, keyFromName, SYNTHETIC_PROVIDER } from "../providers.ts";
import { KbShortcutPanel, MenuHeader } from "./kb-select/kb-shortcut-panel.tsx";
import { Item, Keymap, ShortcutSection } from "./kb-select/kb-shortcut-select.tsx";
import { hasCodexOAuthTokens } from "../codex-oauth.ts";
import { Span } from "paintcannon-react";
import { useKeyboard } from "../hooks/use-keyboard.ts";
import { TerminalFlex } from "./terminal-flex.tsx";
import { loadSyntheticModels } from "../synthetic-models.ts";
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
          auth={stepData.overrideAuth}
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
                  name: getEnvVar(stepData.provider, config, null),
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
  auth: Auth | null;
  onImport: (models: ProviderConfig["models"]) => any;
  onCustomModel: () => any;
  onCancel: () => any;
};

function ImportModelsFrom(props: ImportModelsProps) {
  if (props.provider === SYNTHETIC_PROVIDER) return <SyntheticModelImport {...props} />;
  return <ModelChecklist {...props} models={props.provider.models} />;
}

function SyntheticModelImport(props: ImportModelsProps) {
  const [catalog, setCatalog] = useState<ProviderConfig["models"] | null>(null);
  const { config, auth, onCustomModel } = props;
  useEffect(() => {
    const controller = new AbortController();
    loadSyntheticModels(config, auth, controller.signal).then(result => {
      if (!controller.signal.aborted) setCatalog(result);
    });
    return () => controller.abort();
  }, [config, auth]);
  useEffect(() => {
    if (catalog?.length === 0) onCustomModel();
  }, [catalog, onCustomModel]);
  if (catalog?.length === 0) return null;
  if (catalog === null) {
    return (
      <CenteredBox>
        <TerminalFlex style={{ justifyContent: "center", width: "100%" }}>
          <Span>Loading Synthetic's latest models...</Span>
        </TerminalFlex>
      </CenteredBox>
    );
  }
  return <ModelChecklist {...props} models={catalog} />;
}

function ModelChecklist({
  config,
  provider,
  models,
  onImport,
  onCancel,
  onCustomModel,
}: ImportModelsProps & {
  models: ProviderConfig["models"];
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
  const items: Item<{ type: "model"; id: string }>[] = remainingModels.map(model => {
    const selected = selectedModels.has(model.model) ? "⦿" : "○";
    const isAlias = provider === SYNTHETIC_PROVIDER && model.model.startsWith("syn:");
    const name = isAlias
      ? model.model
          .slice(4)
          .split(":")
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ")
      : model.nickname;
    const detail = isAlias ? ` (${model.nickname})` : "";
    const recommended =
      provider === SYNTHETIC_PROVIDER && model.model === "syn:large:vision" ? " — recommended" : "";
    return {
      label: (
        <>
          {selected} {name}
          {detail && <Span style={{ color: "gray" }}>{detail}</Span>}
          {recommended}
        </>
      ),
      value: { type: "model", id: model.model },
    };
  });
  const recommendedItems =
    provider === SYNTHETIC_PROVIDER ? items.filter(item => item.value.id.startsWith("syn:")) : [];
  const recommendedSlugs = new Set(recommendedItems.map(item => item.value.id));
  const sections: ShortcutSection<Selection>[] =
    provider === SYNTHETIC_PROVIDER
      ? [
          {
            id: "recommended",
            title: "Recommended",
            subtitle: "Pinned to the latest models",
            order: recommendedItems,
          },
          {
            id: "other-models",
            title: "Other models",
            order: items.filter(item => !recommendedSlugs.has(item.value.id)),
          },
        ]
      : [{ id: "other-models", title: "Other models", order: items }];
  const actions: Keymap<Selection> = {
    c: { label: "Import a custom model string…", value: { type: "custom" } },
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
            spaceBefore: 1,
            unindented: true,
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
        shortcutItems={[{ type: "sections", sections }]}
        actions={actions}
        onSelect={({ value }) => {
          switch (value.type) {
            case "custom":
              return onCustomModel();
            case "back":
              return onCancel();
            case "import":
              return onImport(remainingModels.filter(model => selectedModels.has(model.model)));
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
