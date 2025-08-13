import React from "react";
import { t } from "structural";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import json5 from "json5";
import { fileExists } from "./fs-utils.ts";
import { providerForBaseUrl, keyFromName } from "./components/providers.ts";

const __dir = path.dirname(fileURLToPath(import.meta.url));

const KEY_FILE = path.join(os.homedir(), ".config/octofriend/keys.json5");
const KeyConfigSchema = t.dict(t.str);

const McpServerConfigSchema = t.exact({
  command: t.str,
  args: t.optional(t.array(t.str)),
});

const ConfigSchema = t.exact({
  yourName: t.str,
  models: t.array(t.exact({
    type: t.optional(
      t.value("standard").or(t.value("openai-responses")).or(t.value("anthropic")),
    ),
    nickname: t.str,
    baseUrl: t.str,
    apiEnvVar: t.optional(t.str),
    model: t.str,
    context: t.num,
    reasoning: t.optional(t.value("low").or(t.value("medium")).or(t.value("high"))),
  })),
  diffApply: t.optional(t.exact({
    baseUrl: t.str,
    apiEnvVar: t.optional(t.str),
    model: t.str,
  })),
  fixJson: t.optional(t.exact({
    baseUrl: t.str,
    apiEnvVar: t.optional(t.str),
    model: t.str,
  })),
  defaultApiKeyOverrides: t.optional(t.dict(t.str)),
  mcpServers: t.optional(t.dict(McpServerConfigSchema)),
});
export type Config = t.GetType<typeof ConfigSchema>;

export const ConfigContext = React.createContext<Config>({
  yourName: "unknown",
  models: [],
});
export function useConfig() {
  return React.useContext(ConfigContext);
}
export const ConfigPathContext = React.createContext("");

export const SetConfigContext = React.createContext<(c: Config) => any>(() => {});
export function useSetConfig() {
  const set = React.useContext(SetConfigContext);
  const configPath = React.useContext(ConfigPathContext);

  return async (c: Config) => {
    await writeConfig(c, configPath);
    set(c);
  };
}

export async function writeConfig(c: Config, configPath: string) {
  const dir = path.dirname(configPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(configPath, json5.stringify(c, null, 2));
}

export async function assertKeyForModel(
  model: { baseUrl: string, apiEnvVar?: string },
  config: Config | null,
): Promise<string> {
  const key = await readKeyForModel(model, config);
  if(key == null) throw new Error(`No API key defined for ${model.baseUrl}`);
  return key;
}

export async function readKeyForModel(
  model: { baseUrl: string, apiEnvVar?: string },
  config: Config | null,
) {
  if(model.apiEnvVar && process.env[model.apiEnvVar]) return process.env[model.apiEnvVar];
  const provider = providerForBaseUrl(model.baseUrl);
  if(provider) {
    const envVar = (() => {
      const key = keyFromName(provider.name);
      if(config == null) return provider.envVar;
      if(config.defaultApiKeyOverrides == null) return provider.envVar;
      if(config.defaultApiKeyOverrides[key] == null) return provider.envVar;
      return config.defaultApiKeyOverrides[key];
    })();
    if(process.env[envVar]) return process.env[envVar];
  }
  const keys = await readKeys();
  return keys[model.baseUrl] || null;
}

export async function writeKeyForModel(model: { baseUrl: string }, apiKey: string) {
  const keys = await readKeys();
  keys[model.baseUrl] = apiKey;
  await fs.writeFile(KEY_FILE, json5.stringify({
    [model.baseUrl]: apiKey,
  }), {
    mode: 0o600,
  });
}

async function readKeys() {
  const exists = await fileExists(KEY_FILE);
  if(!exists) return {};
  const keyFile = await fs.readFile(KEY_FILE, "utf8");
  return KeyConfigSchema.slice(json5.parse(keyFile));
}

export function getModelFromConfig(config: Config, modelOverride: string | null) {
  if(modelOverride == null) return config.models[0];
  const matching = config.models.find(m => m.nickname === modelOverride);
  if(matching) return matching;
  return config.models[0];
}

export async function readConfig(path: string): Promise<Config> {
  const file = await fs.readFile(path, "utf8");
  return ConfigSchema.slice(json5.parse(file.trim()));
}

export type Metadata = {
  version: string,
};

export async function readMetadata(): Promise<Metadata> {
  const packageFile = await fs.readFile(path.join(__dir, "../../package.json"), "utf8");
  const packageJson = JSON.parse(packageFile);
  return {
    version: packageJson["version"],
  };
}
