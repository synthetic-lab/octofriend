import React, { useState } from "react";
import { CustomAuthFlow } from "./components/add-model-flow.tsx";
import {
  Config,
  writeConfig,
  readConfig,
  mergeEnvVar,
  mergeAutofixEnvVar,
  AuthError,
  readAuthForModel,
} from "./config.ts";
import { HeightlessCenteredBox } from "./components/centered-box.tsx";
import { Span, useApp } from "paintcannon-react";
import { useKeyboard } from "./hooks/use-keyboard.ts";
import { TerminalFlex } from "./components/terminal-flex.tsx";
function matchCodex<T>(
  model: Config["models"][number],
  arms: {
    codex: (
      model: Extract<
        Config["models"][number],
        {
          type: "codex";
        }
      >,
    ) => T;
    others: (
      model: Exclude<
        Config["models"][number],
        {
          type: "codex";
        }
      >,
    ) => T;
  },
): T {
  if (model.type === "codex") return arms.codex(model);
  return arms.others(model);
}
function resolveModelFromConfig(
  config: Config,
  model: Config["models"][number],
): Config["models"][number] {
  const exact = config.models.find(candidate => {
    return matchCodex(model, {
      codex: model => {
        return (
          candidate.type === "codex" &&
          candidate.nickname === model.nickname &&
          candidate.model === model.model
        );
      },
      others: model => {
        if (candidate.type === "codex") return false;
        return candidate.nickname === model.nickname && candidate.baseUrl === model.baseUrl;
      },
    });
  });
  if (exact) return exact;
  return model;
}
function resolveAutofixModelFromConfig<K extends "diffApply" | "fixJson">(
  config: Config,
  model: Exclude<Config[K], undefined>,
  key: K,
): Exclude<Config[K], undefined> {
  const candidate = config[key];
  if (candidate && candidate.baseUrl === model.baseUrl)
    return candidate as Exclude<Config[K], undefined>;
  return (candidate ?? model) as Exclude<Config[K], undefined>;
}
export function PreflightModelAuth({
  model,
  config,
  configPath,
  error,
}: {
  model: Config["models"][number];
  config: Config;
  configPath: string;
  error?: string;
}) {
  const app = useApp();
  const [exitMessage, setExitMessage] = useState<string | null>(null);
  const [authError, setAuthError] = useState<AuthError | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [currentModel, setCurrentModel] = useState(model);
  useKeyboard(async event => {
    if (event.key === "Escape" && authError) {
      setAuthError(null);
      setIsRetrying(false);
    } else if (event.key === "r" && authError && authError.type === "command_failed") {
      setIsRetrying(true);
      const valid = await validateAuth();
      if (valid) {
        app.exit();
      }
    } else if (!(event.key === "Escape")) setExitMessage(null);
  });
  const validateAuth = async () => {
    const reloadedConfig = await readConfig(configPath);
    const resolvedModel = resolveModelFromConfig(reloadedConfig, currentModel);
    setCurrentModel(resolvedModel);
    const result = await readAuthForModel(resolvedModel, reloadedConfig);
    if (result.ok === false) {
      setAuthError(result.error);
      setIsRetrying(false);
      return false;
    }
    return true;
  };
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
        gap: 1,
      }}
    >
      {error && (
        <HeightlessCenteredBox>
          <TerminalFlex
            style={{
              justifyContent: "center",
            }}
          >
            <Span
              style={{
                color: "red",
              }}
            >
              {error}
            </Span>
          </TerminalFlex>
        </HeightlessCenteredBox>
      )}

      {authError && authError.type === "command_failed" && (
        <HeightlessCenteredBox>
          <TerminalFlex
            style={{
              flexDirection: "column",
              gap: 1,
            }}
          >
            <TerminalFlex
              style={{
                justifyContent: "center",
              }}
            >
              <Span
                style={{
                  color: "red",
                }}
              >
                Your auth command failed
              </Span>
            </TerminalFlex>
            <TerminalFlex
              style={{
                justifyContent: "center",
              }}
            >
              <Span
                style={{
                  color: "yellow",
                }}
              >
                {authError.message}
              </Span>
            </TerminalFlex>
            {authError.stderr && (
              <TerminalFlex
                style={{
                  justifyContent: "center",
                }}
              >
                <Span
                  style={{
                    color: "gray",
                  }}
                >
                  stderr: {authError.stderr}
                </Span>
              </TerminalFlex>
            )}
            <TerminalFlex
              style={{
                justifyContent: "center",
                marginTop: 1,
              }}
            >
              <Span
                style={{
                  color: "gray",
                }}
              >
                [R]etry | [ESC] to go back{isRetrying ? " (retrying...)" : ""}
              </Span>
            </TerminalFlex>
          </TerminalFlex>
        </HeightlessCenteredBox>
      )}

      {!authError && (
        <CustomAuthFlow
          config={config}
          authData={
            model.type === "codex"
              ? {
                  modelType: "codex",
                }
              : {
                  modelType: model.type,
                  baseUrl: model.baseUrl,
                }
          }
          onCancel={() => {
            setExitMessage("Press CTRL-C to exit");
          }}
          onComplete={async auth => {
            let index = config.models.indexOf(model);
            let updatedModel = model;
            if (index >= 0 && auth) {
              await matchCodex(model, {
                codex: async model => {
                  if (auth.type === "codex") {
                    const updatedModels = [...config.models];
                    updatedModel = {
                      ...model,
                      auth,
                    };
                    updatedModels[index] = updatedModel;
                    await writeConfig(
                      {
                        ...config,
                        models: updatedModels,
                      },
                      configPath,
                    );
                  }
                },
                others: async model => {
                  if (auth.type === "env") {
                    await writeConfig(mergeEnvVar(config, model, auth.name), configPath);
                  } else if (auth.type === "command") {
                    const updatedModels = [...config.models];
                    updatedModel = {
                      ...model,
                      auth,
                    };
                    updatedModels[index] = updatedModel;
                    await writeConfig(
                      {
                        ...config,
                        models: updatedModels,
                      },
                      configPath,
                    );
                  }
                },
              });
            }
            setCurrentModel(updatedModel);
            // Reload config to ensure we validate against the updated state
            const reloadedConfig = await readConfig(configPath);
            const resolvedModel = resolveModelFromConfig(reloadedConfig, updatedModel);
            setCurrentModel(resolvedModel);
            const result = await readAuthForModel(resolvedModel, reloadedConfig);
            if (result.ok) {
              app.exit();
            } else {
              setAuthError(result.error);
            }
          }}
        />
      )}

      {isRetrying && (
        <HeightlessCenteredBox>
          <Span
            style={{
              color: "gray",
            }}
          >
            Retrying...
          </Span>
        </HeightlessCenteredBox>
      )}

      {!authError && exitMessage && (
        <HeightlessCenteredBox>
          <Span
            style={{
              color: "gray",
            }}
          >
            {exitMessage}
          </Span>
        </HeightlessCenteredBox>
      )}
    </TerminalFlex>
  );
}
export function PreflightAutofixAuth<K extends "diffApply" | "fixJson">({
  autofixKey,
  model,
  config,
  configPath,
}: {
  autofixKey: K;
  model: Exclude<Config[K], undefined>;
  config: Config;
  configPath: string;
}) {
  const app = useApp();
  const [exitMessage, setExitMessage] = useState<string | null>(null);
  const [authError, setAuthError] = useState<AuthError | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [currentModel, setCurrentModel] = useState(model);
  useKeyboard(async event => {
    if (event.key === "Escape" && authError) {
      setAuthError(null);
      setIsRetrying(false);
    } else if (event.key === "r" && authError && authError.type === "command_failed") {
      setIsRetrying(true);
      const valid = await validateAuth();
      if (valid) {
        app.exit();
      }
    } else if (!(event.key === "Escape")) setExitMessage(null);
  });
  const validateAuth = async () => {
    const reloadedConfig = await readConfig(configPath);
    const resolvedModel = resolveAutofixModelFromConfig(reloadedConfig, currentModel, autofixKey);
    setCurrentModel(resolvedModel);
    const result = await readAuthForModel(resolvedModel, reloadedConfig);
    if (result.ok === false) {
      setAuthError(result.error);
      setIsRetrying(false);
      return false;
    }
    return true;
  };
  const modelName = (() => {
    if (autofixKey === "diffApply") return "diff-apply";
    const _: "fixJson" = autofixKey;
    return "fix-json";
  })();
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
        gap: 1,
      }}
    >
      {authError && authError.type === "command_failed" && (
        <HeightlessCenteredBox>
          <TerminalFlex
            style={{
              flexDirection: "column",
              gap: 1,
            }}
          >
            <TerminalFlex
              style={{
                justifyContent: "center",
              }}
            >
              <Span
                style={{
                  color: "red",
                }}
              >
                Your auth command failed
              </Span>
            </TerminalFlex>
            <TerminalFlex
              style={{
                justifyContent: "center",
              }}
            >
              <Span
                style={{
                  color: "yellow",
                }}
              >
                {authError.message}
              </Span>
            </TerminalFlex>
            {authError.stderr && (
              <TerminalFlex
                style={{
                  justifyContent: "center",
                }}
              >
                <Span
                  style={{
                    color: "gray",
                  }}
                >
                  stderr: {authError.stderr}
                </Span>
              </TerminalFlex>
            )}
            <TerminalFlex
              style={{
                justifyContent: "center",
                marginTop: 1,
              }}
            >
              <Span
                style={{
                  color: "gray",
                }}
              >
                [R]etry | [ESC] to go back{isRetrying ? " (retrying...)" : ""}
              </Span>
            </TerminalFlex>
          </TerminalFlex>
        </HeightlessCenteredBox>
      )}

      {!authError && (
        <>
          <HeightlessCenteredBox>
            <TerminalFlex
              style={{
                justifyContent: "center",
              }}
            >
              <Span
                style={{
                  color: "red",
                }}
              >
                {`It looks like we need to set up auth for the ${modelName} model`}
              </Span>
            </TerminalFlex>
          </HeightlessCenteredBox>

          <CustomAuthFlow
            config={config}
            authData={{
              modelType: undefined,
              baseUrl: model.baseUrl,
            }}
            onCancel={() => {
              setExitMessage("Press CTRL-C to exit");
            }}
            onComplete={async auth => {
              let updatedModel = model;
              if (auth) {
                if (auth.type === "env") {
                  await writeConfig(
                    mergeAutofixEnvVar(config, autofixKey, model, auth.name),
                    configPath,
                  );
                } else if (auth.type === "command") {
                  const merged = {
                    ...config,
                  };
                  updatedModel = {
                    ...model,
                    auth,
                  };
                  merged[autofixKey] = updatedModel;
                  await writeConfig(merged, configPath);
                }
              }
              setCurrentModel(updatedModel);
              // Reload config to ensure we validate against the updated state
              const reloadedConfig = await readConfig(configPath);
              const resolvedModel = resolveAutofixModelFromConfig(
                reloadedConfig,
                updatedModel,
                autofixKey,
              );
              setCurrentModel(resolvedModel);
              const result = await readAuthForModel(resolvedModel, reloadedConfig);
              if (result.ok) {
                app.exit();
              } else {
                setAuthError(result.error);
              }
            }}
          />
        </>
      )}

      {isRetrying && (
        <HeightlessCenteredBox>
          <Span
            style={{
              color: "gray",
            }}
          >
            Retrying...
          </Span>
        </HeightlessCenteredBox>
      )}

      {!authError && exitMessage && (
        <HeightlessCenteredBox>
          <Span
            style={{
              color: "gray",
            }}
          >
            {exitMessage}
          </Span>
        </HeightlessCenteredBox>
      )}
    </TerminalFlex>
  );
}
