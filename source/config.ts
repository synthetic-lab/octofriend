import React from "react";
import { t } from "structural";
import readline from "readline/promises";
import fs from "fs/promises";
import path from "path";
import chalk from "chalk";
import { fileURLToPath } from "url";
import json5 from "json5";
import OpenAI from "openai";
import figlet from "figlet";
import { THEME_COLOR } from "./theme.ts";

const __dir = path.dirname(fileURLToPath(import.meta.url));

const McpServerConfigSchema = t.exact({
  command: t.str,
  args: t.optional(t.array(t.str)),
});

const ConfigSchema = t.exact({
  yourName: t.str,
  models: t.array(t.exact({
    nickname: t.str,
    baseUrl: t.str,
    apiEnvVar: t.str,
    model: t.str,
    context: t.num,
  })),
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
    const dir = path.dirname(configPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(configPath, json5.stringify(c, null, 2));
    set(c);
  };
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
  const packageFile = await fs.readFile(path.join(__dir, "../package.json"), "utf8");
  const packageJson = JSON.parse(packageFile);
  return {
    version: packageJson["version"],
  };
}

export function addModel(model: Config["models"][number]) {
}
