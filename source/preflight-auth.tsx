import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { CustomAuthFlow } from "./components/add-model-flow.tsx";
import {
  Config,
  writeConfig,
  readConfig,
  mergeEnvVar,
  mergeAutofixEnvVar,
  AuthError,
  readKeyForModelWithDetails,
} from "./config.ts";
import { HeightlessCenteredBox } from "./components/centered-box.tsx";

function resolveModelFromConfig(
  config: Config,
  model: Config["models"][number],
): Config["models"][number] {
  const exact = config.models.find(
    candidate => candidate.nickname === model.nickname && candidate.baseUrl === model.baseUrl,
  );
  if (exact) return exact;
  const fallback = config.models.find(candidate => candidate.baseUrl === model.baseUrl);
  return fallback ?? model;
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

  useInput(async (input, key) => {
    if (key.escape && authError) {
      setAuthError(null);
      setIsRetrying(false);
    } else if (input === "r" && authError && authError.type === "command_failed") {
      setIsRetrying(true);
      const valid = await validateAuth();
      if (valid) {
        app.exit();
      }
    } else if (!key.escape) setExitMessage(null);
  });

  const validateAuth = async () => {
    const reloadedConfig = await readConfig(configPath);
    const resolvedModel = resolveModelFromConfig(reloadedConfig, currentModel);
    setCurrentModel(resolvedModel);
    const result = await readKeyForModelWithDetails(resolvedModel, reloadedConfig);
    if (result.ok === false) {
      setAuthError(result.error);
      setIsRetrying(false);
      return false;
    }
    return true;
  };

  return (
    <Box flexDirection="column" gap={1}>
      {error && (
        <HeightlessCenteredBox>
          <Box justifyContent="center">
            <Text color="red">{error}</Text>
          </Box>
        </HeightlessCenteredBox>
      )}

      {authError && authError.type === "command_failed" && (
        <HeightlessCenteredBox>
          <Box flexDirection="column" gap={1}>
            <Box justifyContent="center">
              <Text color="red">Your auth command failed</Text>
            </Box>
            <Box justifyContent="center">
              <Text color="yellow">{authError.message}</Text>
            </Box>
            {authError.stderr && (
              <Box justifyContent="center">
                <Text color="gray">stderr: {authError.stderr}</Text>
              </Box>
            )}
            <Box justifyContent="center" marginTop={1}>
              <Text dimColor>[R]etry | [ESC] to go back{isRetrying ? " (retrying...)" : ""}</Text>
            </Box>
          </Box>
        </HeightlessCenteredBox>
      )}

      {!authError && (
        <CustomAuthFlow
          config={config}
          baseUrl={model.baseUrl}
          onCancel={() => {
            setExitMessage("Press CTRL-C to exit");
          }}
          onComplete={async auth => {
            let index = config.models.indexOf(model);
            let updatedModel = model;
            if (index >= 0 && auth) {
              if (auth.type === "env") {
                await writeConfig(mergeEnvVar(config, model, auth.name), configPath);
              } else {
                const updatedModels = [...config.models];
                updatedModel = { ...model, auth };
                updatedModels[index] = updatedModel;
                await writeConfig({ ...config, models: updatedModels }, configPath);
              }
            }
            setCurrentModel(updatedModel);
            // Reload config to ensure we validate against the updated state
            const reloadedConfig = await readConfig(configPath);
            const resolvedModel = resolveModelFromConfig(reloadedConfig, updatedModel);
            setCurrentModel(resolvedModel);
            const result = await readKeyForModelWithDetails(resolvedModel, reloadedConfig);
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
          <Text color="gray">Retrying...</Text>
        </HeightlessCenteredBox>
      )}

      {!authError && exitMessage && (
        <HeightlessCenteredBox>
          <Text color="gray">{exitMessage}</Text>
        </HeightlessCenteredBox>
      )}
    </Box>
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

  useInput(async (input, key) => {
    if (key.escape && authError) {
      setAuthError(null);
      setIsRetrying(false);
    } else if (input === "r" && authError && authError.type === "command_failed") {
      setIsRetrying(true);
      const valid = await validateAuth();
      if (valid) {
        app.exit();
      }
    } else if (!key.escape) setExitMessage(null);
  });

  const validateAuth = async () => {
    const reloadedConfig = await readConfig(configPath);
    const resolvedModel = resolveAutofixModelFromConfig(reloadedConfig, currentModel, autofixKey);
    setCurrentModel(resolvedModel);
    const result = await readKeyForModelWithDetails(resolvedModel, reloadedConfig);
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
    <Box flexDirection="column" gap={1}>
      {authError && authError.type === "command_failed" && (
        <HeightlessCenteredBox>
          <Box flexDirection="column" gap={1}>
            <Box justifyContent="center">
              <Text color="red">Your auth command failed</Text>
            </Box>
            <Box justifyContent="center">
              <Text color="yellow">{authError.message}</Text>
            </Box>
            {authError.stderr && (
              <Box justifyContent="center">
                <Text color="gray">stderr: {authError.stderr}</Text>
              </Box>
            )}
            <Box justifyContent="center" marginTop={1}>
              <Text dimColor>[R]etry | [ESC] to go back{isRetrying ? " (retrying...)" : ""}</Text>
            </Box>
          </Box>
        </HeightlessCenteredBox>
      )}

      {!authError && (
        <>
          <HeightlessCenteredBox>
            <Box justifyContent="center">
              <Text color="red">
                {`It looks like we need to set up auth for the ${modelName} model`}
              </Text>
            </Box>
          </HeightlessCenteredBox>

          <CustomAuthFlow
            config={config}
            baseUrl={model.baseUrl}
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
                } else {
                  const merged = { ...config };
                  updatedModel = { ...model, auth };
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
              const result = await readKeyForModelWithDetails(resolvedModel, reloadedConfig);
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
          <Text color="gray">Retrying...</Text>
        </HeightlessCenteredBox>
      )}

      {!authError && exitMessage && (
        <HeightlessCenteredBox>
          <Text color="gray">{exitMessage}</Text>
        </HeightlessCenteredBox>
      )}
    </Box>
  );
}
