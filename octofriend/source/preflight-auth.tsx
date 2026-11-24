import React, { useState } from "react";
import { CustomAuthFlow } from "./components/add-model-flow.tsx";
import {
  Config,
  writeConfig,
  readConfig,
  mergeEnvVar,
  AuthError,
  readAuthForModel,
} from "./config.ts";
import { HeightlessCenteredBox } from "./components/centered-box.tsx";
import { Span, useApp } from "paintcannon-react";
import { useKeyboard } from "./hooks/use-keyboard.ts";
import { TerminalFlex } from "./components/terminal-flex.tsx";
import { AppShell } from "./components/app-shell.tsx";

function PreflightShell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <TerminalFlex
        style={{
          flexDirection: "column",
          flexGrow: 1,
          flexShrink: 1,
          flexBasis: 0,
          minWidth: 0,
          minHeight: 0,
          width: "100%",
          justifyContent: "center",
        }}
      >
        {children}
      </TerminalFlex>
    </AppShell>
  );
}

function ModelDetails({
  name,
  model,
  baseUrl,
}: {
  name: string;
  model?: string;
  baseUrl?: string;
}) {
  const displayName = model && model !== name ? `${name} (${model})` : name;
  return (
    <HeightlessCenteredBox>
      <TerminalFlex
        style={{
          flexDirection: "column",
        }}
      >
        <Span>Model: {displayName}</Span>
        {baseUrl && <Span>Base URL: {baseUrl}</Span>}
      </TerminalFlex>
    </HeightlessCenteredBox>
  );
}

function AuthErrorPanel({ error, isRetrying }: { error: AuthError; isRetrying: boolean }) {
  const title = (() => {
    if (error.type === "missing") return "Auth is still missing";
    if (error.type === "invalid") return "Your auth configuration is invalid";
    return "Your auth command failed";
  })();
  return (
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
            {title}
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
            {error.message}
          </Span>
        </TerminalFlex>
        {error.type === "command_failed" && error.stderr && (
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
              stderr: {error.stderr}
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
            {error.type === "command_failed" ? "[R]etry | " : ""}[ESC] to go back
            {isRetrying ? " (retrying...)" : ""}
          </Span>
        </TerminalFlex>
      </TerminalFlex>
    </HeightlessCenteredBox>
  );
}

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
    <PreflightShell>
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

        <ModelDetails
          name={model.nickname}
          model={model.type === "codex" ? undefined : model.model}
          baseUrl={model.type === "codex" ? undefined : model.baseUrl}
        />

        {authError && <AuthErrorPanel error={authError} isRetrying={isRetrying} />}

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
              const index = config.models.indexOf(model);
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
    </PreflightShell>
  );
}
