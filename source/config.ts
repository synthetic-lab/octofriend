import React from "react";
import { t } from "structural";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import json5 from "json5";
import { execFile } from "child_process";
import { fileExists } from "./fs-utils.ts";
import { providerForBaseUrl, keyFromName, ProviderConfig } from "./providers.ts";

const __dir = path.dirname(fileURLToPath(import.meta.url));

const CONFIG_DIR = path.join(os.homedir(), ".config/octofriend");
const KEY_FILE = path.join(CONFIG_DIR, "keys.json5");
const KeyConfigSchema = t.dict(t.str);
export const DEFAULT_AUTOCOMPACT_THRESHOLD = 0.8;

const McpServerConfigSchema = t.exact({
  command: t.str,
  args: t.optional(t.array(t.str)),
  env: t.optional(t.dict(t.str)),
});

const AuthSchema = t
  .exact({
    type: t.value("env"),
    name: t.str,
  })
  .or(
    t.exact({
      type: t.value("command"),
      command: t.array(t.str),
    }),
  );
export type Auth = t.GetType<typeof AuthSchema>;

export type AuthError =
  | { type: "missing"; message: string }
  | { type: "command_failed"; message: string; exitCode?: number; stderr?: string }
  | { type: "invalid"; message: string };

export type KeyResult = { ok: true; key: string } | { ok: false; error: AuthError };

const MultimodalConfigSchema = t.exact({
  enabled: t.bool,
  maxSize: t.num, // in MB
});

const ModelConfigSchema = t.exact({
  type: t.optional(t.value("standard").or(t.value("openai-responses")).or(t.value("anthropic"))),
  nickname: t.str,
  baseUrl: t.str,
  apiEnvVar: t.optional(t.str), // deprecated: use auth instead
  auth: t.optional(AuthSchema),
  model: t.str,
  context: t.num,
  reasoning: t.optional(t.value("low").or(t.value("medium")).or(t.value("high"))),
  multimodal: t.optional(MultimodalConfigSchema),
});
export type ModelConfig = t.GetType<typeof ModelConfigSchema>;

const ConfigSchema = t.exact({
  yourName: t.str,
  models: t.array(ModelConfigSchema),
  diffApply: t.optional(
    t.exact({
      baseUrl: t.str,
      apiEnvVar: t.optional(t.str), // deprecated: use auth instead
      auth: t.optional(AuthSchema),
      model: t.str,
    }),
  ),
  fixJson: t.optional(
    t.exact({
      baseUrl: t.str,
      apiEnvVar: t.optional(t.str), // deprecated: use auth instead
      auth: t.optional(AuthSchema),
      model: t.str,
    }),
  ),
  vimEmulation: t.optional(
    t.subtype({
      enabled: t.bool,
    }),
  ),
  search: t.optional(
    t.subtype({
      url: t.str,
      apiEnvVar: t.optional(t.str), // deprecated: use auth instead
      auth: t.optional(AuthSchema),
    }),
  ),
  defaultApiKeyOverrides: t.optional(t.dict(t.str)),
  mcpServers: t.optional(t.dict(McpServerConfigSchema)),
  skills: t.optional(
    t.exact({
      paths: t.optional(t.array(t.str)),
    }),
  ),
});
export type Config = t.GetType<typeof ConfigSchema>;
export const AUTOFIX_KEYS = ["diffApply", "fixJson"] as const;

// In-memory cache for command-based auth (keyed by command joined with null byte)
const authCommandCache = new Map<string, string>();

const AUTH_COMMAND_TIMEOUT_MS = 15_000;
const AUTH_COMMAND_MAX_OUTPUT_BYTES = 16 * 1024;

/**
 * Resolves an Auth config to an API key.
 * For env auth, reads from process.env.
 * For command auth, executes the command (with caching).
 */
export async function resolveAuth(auth: Auth): Promise<KeyResult> {
  if (auth.type === "env") {
    const value = process.env[auth.name];
    if (value == null || value === "") {
      return {
        ok: false,
        error: { type: "missing", message: `Environment variable ${auth.name} is not set` },
      };
    }
    return { ok: true, key: value };
  }

  // Command auth
  const cacheKey = auth.command.join("\0");
  const cached = authCommandCache.get(cacheKey);
  if (cached != null) {
    return { ok: true, key: cached };
  }

  const [cmd, ...args] = auth.command;
  if (!cmd) {
    return {
      ok: false,
      error: { type: "invalid", message: "Auth command is empty" },
    };
  }

  return new Promise(resolve => {
    let stdout = "";
    let stderr = "";
    let resolved = false;

    const child = execFile(
      cmd,
      args,
      {
        timeout: AUTH_COMMAND_TIMEOUT_MS,
        maxBuffer: AUTH_COMMAND_MAX_OUTPUT_BYTES,
        shell: false,
        env: process.env,
      },
      (error, stdoutBuf, stderrBuf) => {
        if (resolved) return;
        resolved = true;

        stdout = stdoutBuf?.toString() ?? "";
        stderr = stderrBuf?.toString() ?? "";

        if (error) {
          resolve({
            ok: false,
            error: {
              type: "command_failed",
              message: error.message,
              exitCode: "code" in error ? (error.code as number) : undefined,
              stderr: stderr.slice(0, 500),
            },
          });
          return;
        }

        const key = stdout.trim();
        if (key === "") {
          resolve({
            ok: false,
            error: { type: "invalid", message: "Auth command returned empty output" },
          });
          return;
        }

        authCommandCache.set(cacheKey, key);
        resolve({ ok: true, key });
      },
    );

    // execFile should kill on timeout, but just to be safe
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill("SIGKILL");
        resolve({
          ok: false,
          error: {
            type: "command_failed",
            message: `Auth command timed out after ${AUTH_COMMAND_TIMEOUT_MS}ms`,
          },
        });
      }
    }, AUTH_COMMAND_TIMEOUT_MS + 1000);
  });
}

/**
 * Converts legacy apiEnvVar to Auth, or returns existing auth.
 * Used for migration compatibility.
 */
export function getAuthForModel(model: { auth?: Auth; apiEnvVar?: string }): Auth | null {
  if (model.auth) return model.auth;
  if (model.apiEnvVar) return { type: "env", name: model.apiEnvVar };
  return null;
}

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

export function mergeEnvVar(config: Config, model: Config["models"][number], apiEnvVar: string) {
  const provider = providerForBaseUrl(model.baseUrl);
  let merged = { ...config, models: [...config.models] };
  const index = merged.models.indexOf(model);
  if (index < 0) throw new Error("Couldn't find model in models list");

  if (provider) {
    const key = keyFromName(provider.name);
    const defaultEnvVar = getDefaultEnvVar(provider, config);
    if (defaultEnvVar === apiEnvVar) return merged;
    const overrides = merged.defaultApiKeyOverrides || {};
    overrides[key] = apiEnvVar;
    merged.defaultApiKeyOverrides = overrides;
    delete merged.models[index].apiEnvVar;
    return merged;
  }

  merged.models[index] = {
    ...model,
    apiEnvVar,
  };

  return merged;
}

export function mergeAutofixEnvVar<K extends (typeof AUTOFIX_KEYS)[number]>(
  config: Config,
  key: K,
  model: Exclude<Config[K], undefined>,
  apiEnvVar: string,
) {
  const provider = providerForBaseUrl(model.baseUrl);
  let merged = { ...config };
  if (provider) {
    const providerKey = keyFromName(provider.name);
    const defaultEnvVar = getDefaultEnvVar(provider, config);
    if (defaultEnvVar === apiEnvVar) return merged;
    const overrides = merged.defaultApiKeyOverrides || {};
    overrides[providerKey] = apiEnvVar;
    merged.defaultApiKeyOverrides = overrides;
    if (merged[key]) delete merged[key].apiEnvVar;
    return merged;
  }

  merged[key] = {
    ...model,
    apiEnvVar,
  };

  return merged;
}

function getDefaultEnvVar(provider: ProviderConfig, config: Config) {
  const key = keyFromName(provider.name);
  const defaultEnvVar = (() => {
    if (config.defaultApiKeyOverrides == null) return provider.envVar;
    if (config.defaultApiKeyOverrides[key] == null) return provider.envVar;
    return config.defaultApiKeyOverrides[key];
  })();
  return defaultEnvVar;
}

export async function writeConfig(c: Config, configPath: string) {
  const dir = path.dirname(configPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(configPath, json5.stringify(sanitizeConfig(c), null, 2));
}

function sanitizeConfig(c: Config): Config {
  const sanitized = { ...c, models: [...c.models] };
  for (let index = 0; index < sanitized.models.length; index++) {
    const model = sanitized.models[index];
    const provider = providerForBaseUrl(model.baseUrl);
    if (provider) {
      const envVar = getDefaultEnvVar(provider, c);
      if (envVar === model.apiEnvVar) {
        sanitized.models[index] = { ...model };
        delete sanitized.models[index].apiEnvVar;
      }
    }
  }

  for (const key of AUTOFIX_KEYS) {
    const model = sanitized[key];
    if (model) {
      const provider = providerForBaseUrl(model.baseUrl);
      if (provider) {
        const envVar = getDefaultEnvVar(provider, sanitized);
        if (envVar === model.apiEnvVar) {
          sanitized[key] = {
            ...model,
          };
          delete sanitized[key].apiEnvVar;
        }
      }
    }
  }

  return sanitized;
}

export async function readSearchConfig(config: Config | null) {
  if (config?.search) {
    const search = config.search;
    const url = config.search.url;
    const key = await (async () => {
      const auth = getAuthForModel(search);
      if (auth) {
        const result = await resolveAuth(auth);
        if (result.ok) return result.key;
      }
      return await readKeyForBaseUrl(url, config);
    })();
    if (key != null) return { url, key };
    return null;
  }

  const url = "https://api.synthetic.new/v2/search";
  const key = await findSyntheticKey(config);

  if (key != null) return { key, url };
  return null;
}

// Attempts to find a valid key for Synthetic. This is useful for features we know Synthetic
// supports, e.g. the web search tool
async function findSyntheticKey(config: Config | null) {
  const overrides = config?.defaultApiKeyOverrides;
  const override = overrides == null ? null : overrides["synthetic"];
  if (override) return process.env[override];

  // Every API base URL Synthetic has ever used
  const validBaseUrls = [
    "https://api.synthetic.new/openai/v1",
    "https://synthetic.new/api/openai/v1",
    "https://api.synthetic.new/v1",
    "https://api.glhf.chat/v1",
    "https://glhf.chat/api/v1",
    "https://glhf.chat/api/openai/v1",
  ];

  for (const base of validBaseUrls) {
    const key = await readKeyForBaseUrl(base, config);
    if (key != null) return key;
  }

  return null;
}

export async function assertKeyForModel(
  model: { baseUrl: string; apiEnvVar?: string; auth?: Auth },
  config: Config | null,
): Promise<string> {
  const result = await readKeyForModelWithDetails(model, config);
  if (!result.ok) throw new Error(result.error.message);
  return result.key;
}

// Use this when you only need the key and don't need detailed auth errors.
export async function readKeyForModel(
  model: { baseUrl: string; apiEnvVar?: string; auth?: Auth },
  config: Config | null,
): Promise<string | null> {
  const result = await readKeyForModelWithDetails(model, config);
  return result.ok ? result.key : null;
}

// Use this when you need to surface auth failures (missing env vars, command failures, invalid
// configs) to the user.
export async function readKeyForModelWithDetails(
  model: { baseUrl: string; apiEnvVar?: string; auth?: Auth },
  config: Config | null,
): Promise<KeyResult> {
  const auth = getAuthForModel(model);
  if (auth) {
    const result = await resolveAuth(auth);
    if (result.ok) return result;
    // If auth is configured but failed, return the error (don't fall through)
    return result;
  }

  // Otherwise, search for a key for this model's base URL
  return await readKeyForBaseUrlResult(model.baseUrl, config);
}

export async function readKeyForBaseUrl(
  baseUrl: string,
  config: Config | null,
): Promise<string | null> {
  const result = await readKeyForBaseUrlResult(baseUrl, config);
  return result.ok ? result.key : null;
}

export async function readKeyForBaseUrlResult(
  baseUrl: string,
  config: Config | null,
): Promise<KeyResult> {
  // Is it a URL for a built-in provider? Check those first
  const provider = providerForBaseUrl(baseUrl);
  if (provider) {
    const envVar = (() => {
      const key = keyFromName(provider.name);
      if (config == null) return provider.envVar;
      if (config.defaultApiKeyOverrides == null) return provider.envVar;
      if (config.defaultApiKeyOverrides[key] == null) return provider.envVar;
      return config.defaultApiKeyOverrides[key];
    })();
    if (process.env[envVar]) return { ok: true, key: process.env[envVar] };
  }

  // Is there an entry for it in the keys file?
  const keys = await readKeys();
  if (keys[baseUrl] != null) return { ok: true, key: keys[baseUrl] };

  // Does it match an existing model with auth or API env var defined?
  for (const model of config?.models || []) {
    if (model.baseUrl == baseUrl) {
      const auth = getAuthForModel(model);
      if (auth) {
        const result = await resolveAuth(auth);
        if (result.ok) return result;
      }
    }
  }

  // Does it match a fix-json or diff-apply model?
  if (config?.diffApply?.baseUrl === baseUrl) {
    const auth = getAuthForModel(config.diffApply);
    if (auth) {
      const result = await resolveAuth(auth);
      if (result.ok) return result;
    }
  }
  if (config?.fixJson?.baseUrl === baseUrl) {
    const auth = getAuthForModel(config.fixJson);
    if (auth) {
      const result = await resolveAuth(auth);
      if (result.ok) return result;
    }
  }

  // We can't find the key for it
  return { ok: false, error: { type: "missing", message: `No API key found for ${baseUrl}` } };
}

export async function writeKeyForModel(model: { baseUrl: string }, apiKey: string) {
  const keys = await readKeys();
  keys[model.baseUrl] = apiKey;
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(KEY_FILE, json5.stringify(keys), {
    mode: 0o600,
  });
}

async function readKeys() {
  const exists = await fileExists(KEY_FILE);
  if (!exists) return {};
  const keyFile = await fs.readFile(KEY_FILE, "utf8");
  return KeyConfigSchema.slice(json5.parse(keyFile));
}

export function getModelFromConfig(config: Config, modelOverride: string | null) {
  if (modelOverride == null) return config.models[0];
  const matching = config.models.find(m => m.nickname === modelOverride);
  if (matching) return matching;
  return config.models[0];
}

export async function readConfig(path: string): Promise<Config> {
  const file = await fs.readFile(path, "utf8");
  return ConfigSchema.slice(json5.parse(file.trim()));
}

export type Metadata = {
  version: string;
};

export async function readMetadata(): Promise<Metadata> {
  const packageFile = await fs.readFile(path.join(__dir, "../../package.json"), "utf8");
  const packageJson = JSON.parse(packageFile);

  return {
    version: packageJson["version"],
  };
}
