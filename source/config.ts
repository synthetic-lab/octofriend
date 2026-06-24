import React from "react";
import { t } from "structural";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import json5 from "json5";
import { execFile, spawn } from "child_process";
import { fileExists } from "./fs-utils.ts";
import { providerForBaseUrl, keyFromName, ProviderConfig } from "./providers.ts";
import { getCodexOAuthTokens } from "./codex-oauth.ts";

const __dir = path.dirname(fileURLToPath(import.meta.url));

const CONFIG_DIR = path.join(os.homedir(), ".config/octofriend");
const KEY_FILE = path.join(CONFIG_DIR, "keys.json5");
const KeyConfigSchema = t.dict(t.str);
export const DEFAULT_AUTOCOMPACT_THRESHOLD = 0.8;

export const APP_METADATA = await readMetadata();
export const CURRENT_CONFIG_VERSION = 2;

type Migration = (raw: Record<string, any>) => Record<string, any>;

const MIGRATIONS: Record<number, Migration> = {
  1: raw => ({
    ...raw,
    models: (Array.isArray(raw["models"]) ? raw["models"] : []).map((model: any) => {
      const provider = providerForBaseUrl(model.baseUrl) as ProviderConfig | null;
      const canonical = provider?.models.find((m: any) => m.model === model.model);
      if (canonical?.modalities !== undefined)
        return { ...model, modalities: canonical.modalities };
      return model;
    }),
  }),
  2: raw => {
    const notifyCommand = raw["notifyFinishCommand"];
    if (notifyCommand === undefined) {
      return raw;
    }
    delete raw["notifyFinishCommand"];
    return {
      ...raw,
      notifications: {
        notifyCommand,
      },
    };
  },
};

function migrateConfig(raw: Record<string, any>): Record<string, any> {
  let version: number = raw["configVersion"] ?? 0;
  while (version < CURRENT_CONFIG_VERSION) {
    const migration = MIGRATIONS[version + 1];
    if (migration) raw = migration(raw);
    version++;
  }
  return { ...raw, configVersion: CURRENT_CONFIG_VERSION };
}

const McpServerConfigSchema = t.exact({
  command: t.str,
  args: t.optional(t.array(t.str)),
  env: t.optional(t.dict(t.str)),
});

export const LspServerConfigSchema = t.exact({
  command: t.array(t.str),
  extensions: t.array(t.str),
  rootCandidates: t.array(t.str),
});
export type LspServerConfig = t.GetType<typeof LspServerConfigSchema>;

export const LspEntrySchema = t
  .exact({
    disabled: t.value(true as const),
  })
  .or(LspServerConfigSchema);
export type LspEntry = t.GetType<typeof LspEntrySchema>;

const EnvAuthSchema = t.exact({
  type: t.value("env"),
  name: t.str,
});
const CommandAuthSchema = t.exact({
  type: t.value("command"),
  command: t.array(t.str),
});
const ApiKeyAuthConfigSchema = EnvAuthSchema.or(CommandAuthSchema);
const CodexAuthConfigSchema = t.exact({
  type: t.value("codex"),
});
const AuthSchema = ApiKeyAuthConfigSchema.or(CodexAuthConfigSchema);
export type Auth = t.GetType<typeof AuthSchema>;
export type ApiKeyAuthConfig = t.GetType<typeof ApiKeyAuthConfigSchema>;
export type CodexAuthConfig = t.GetType<typeof CodexAuthConfigSchema>;

export type AuthError =
  | { type: "missing"; message: string }
  | { type: "command_failed"; message: string; exitCode?: number; stderr?: string }
  | { type: "invalid"; message: string };

export type ApiKeyAuth = { type: "apiKey"; apiKey: string };
export type OAuthLoadedAuth = { type: "oauth"; oauthToken: string; accountId?: string };
export type LoadedAuth = ApiKeyAuth | OAuthLoadedAuth;
export type AuthResult = { ok: true; auth: LoadedAuth } | { ok: false; error: AuthError };
type ApiKeyAuthResult = { ok: true; auth: ApiKeyAuth } | { ok: false; error: AuthError };
type CodexAuthResult = { ok: true; auth: OAuthLoadedAuth } | { ok: false; error: AuthError };

const ModelTypeSchema = t
  .value("standard")
  .or(t.value("openai-responses"))
  .or(t.value("anthropic"));
const ReasoningSchema = t
  .value("low")
  .or(t.value("medium"))
  .or(t.value("high"))
  .or(t.value("xhigh"));
const ModalitiesSchema = t.subtype({
  image: t.optional(
    t.subtype({
      enabled: t.bool,
      maxSizeMB: t.num,
      acceptedMimeTypes: t.array(t.str),
    }),
  ),
});

const ModelConfigBaseSchema = t.subtype({
  nickname: t.str,
  model: t.str,
  context: t.num,
  reasoning: t.optional(ReasoningSchema),
  modalities: t.optional(ModalitiesSchema),
});
const ApiKeyModelConfigSchema = ModelConfigBaseSchema.and(
  t.subtype({
    type: t.optional(ModelTypeSchema),
    baseUrl: t.str,
    // deprecated: use auth instead
    apiEnvVar: t.optional(t.str),
    auth: t.optional(ApiKeyAuthConfigSchema),
  }),
);
const CodexModelConfigSchema = ModelConfigBaseSchema.and(
  t.subtype({
    type: t.value("codex"),
    auth: t.optional(CodexAuthConfigSchema),
  }),
);
const ModelConfigSchema = ApiKeyModelConfigSchema.or(CodexModelConfigSchema);
export type ApiKeyModelConfig = t.GetType<typeof ApiKeyModelConfigSchema>;
export type CodexModelConfig = t.GetType<typeof CodexModelConfigSchema>;
export type ModelConfigBase = t.GetType<typeof ModelConfigBaseSchema>;
export type ModelConfig = t.GetType<typeof ModelConfigSchema>;

const AutofixAuthSchema = ApiKeyAuthConfigSchema;
const AutofixModelConfigSchema = t.exact({
  baseUrl: t.str,
  apiEnvVar: t.optional(t.str), // deprecated: use auth instead
  auth: t.optional(AutofixAuthSchema),
  model: t.str,
});

const ConfigSchema = t.exact({
  configVersion: t.optional(t.num),
  yourName: t.str,
  models: t.array(ModelConfigSchema),
  diffApply: t.optional(AutofixModelConfigSchema),
  fixJson: t.optional(AutofixModelConfigSchema),
  vimEmulation: t.optional(
    t.subtype({
      enabled: t.bool,
    }),
  ),
  search: t.optional(
    t.subtype({
      url: t.str,
      apiEnvVar: t.optional(t.str), // deprecated: use auth instead
      auth: t.optional(ApiKeyAuthConfigSchema),
    }),
  ),
  defaultApiKeyOverrides: t.optional(t.dict(t.str)),
  mcpServers: t.optional(t.dict(McpServerConfigSchema)),
  lsp: t.optional(t.value(false as const).or(t.dict(LspEntrySchema))),
  skills: t.optional(
    t.exact({
      paths: t.optional(t.array(t.str)),
    }),
  ),
  notifications: t.optional(
    t.subtype({
      notifyCommand: t.str,
      notifyTimeoutMs: t.optional(t.num),
      alwaysNotify: t.optional(t.bool),
    }),
  ),
});
export type Config = t.GetType<typeof ConfigSchema>;
export const AUTOFIX_KEYS = ["diffApply", "fixJson"] as const;

// In-memory cache for command-based auth (keyed by command joined with null byte)
const authCommandCache = new Map<string, string>();

const AUTH_COMMAND_TIMEOUT_MS = 15_000;
const AUTH_COMMAND_MAX_OUTPUT_BYTES = 16 * 1024;

const NOTIFY_COMMAND_TIMEOUT_MS = 10_000;

export async function runNotifyCommand(config: Config): Promise<void> {
  const cmd = config.notifications?.notifyCommand;
  if (!cmd || cmd.trim() === "") return;
  const shell = process.env["SHELL"] || "/bin/sh";

  await new Promise<void>((resolve, reject) => {
    const child = spawn(shell, ["-c", cmd], {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: NOTIFY_COMMAND_TIMEOUT_MS,
      env: process.env,
    });

    child.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`notifyFinishCommand exited with code ${code}`));
        return;
      }
      resolve();
    });

    child.on("error", reject);
  });
}

export function apiKeyFromAuth(auth: ApiKeyAuth): string {
  return auth.apiKey;
}

export function resolveAuth(auth: CodexAuthConfig): Promise<CodexAuthResult>;
export function resolveAuth(auth: ApiKeyAuthConfig): Promise<ApiKeyAuthResult>;
export function resolveAuth(auth: Auth): Promise<AuthResult>;
export async function resolveAuth(auth: Auth): Promise<AuthResult> {
  if (auth.type === "codex") {
    const tokens = await getCodexOAuthTokens();
    if (!tokens.success) {
      return {
        ok: false,
        error: {
          type: "invalid",
          message: tokens.error,
        },
      };
    }
    if (tokens.data) {
      return {
        ok: true,
        auth: {
          type: "oauth",
          oauthToken: tokens.data.access,
          ...(tokens.data.accountId ? { accountId: tokens.data.accountId } : {}),
        },
      };
    }
    return {
      ok: false,
      error: {
        type: "missing",
        message: "No Codex OAuth credentials found.",
      },
    };
  }

  if (auth.type === "env") {
    const value = process.env[auth.name];
    if (value == null || value === "") {
      return {
        ok: false,
        error: { type: "missing", message: `Environment variable ${auth.name} is not set` },
      };
    }
    return { ok: true, auth: { type: "apiKey", apiKey: value } };
  }

  // Command auth
  const cacheKey = auth.command.join("\0");
  const cached = authCommandCache.get(cacheKey);
  if (cached != null) {
    return { ok: true, auth: { type: "apiKey", apiKey: cached } };
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
        resolve({ ok: true, auth: { type: "apiKey", apiKey: key } });
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
function getAuthForModel(model: {
  type?: ModelConfig["type"];
  auth?: Auth;
  apiEnvVar?: string;
}): Auth | null {
  if (model.auth?.type === "codex" || model.type === "codex") return { type: "codex" };
  if (model.auth) return model.auth;
  if (model.apiEnvVar) return { type: "env", name: model.apiEnvVar };
  return null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
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

export function withServerDisabled(serverName: string, config: Config): Config {
  const existing = config.lsp === false ? {} : (config.lsp ?? {});
  return { ...config, lsp: { ...existing, [serverName]: { disabled: true } } };
}

export function withAllServersDisabled(config: Config): Config {
  return { ...config, lsp: false };
}

export function mergeEnvVar(config: Config, model: ApiKeyModelConfig, apiEnvVar: string) {
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
    const updatedModel = { ...model };
    delete updatedModel.apiEnvVar;
    merged.models[index] = updatedModel;
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
  await fs.writeFile(
    configPath,
    json5.stringify({ configVersion: CURRENT_CONFIG_VERSION, ...sanitizeConfig(c) }, null, 2),
  );
}

function sanitizeConfig(c: Config): Config {
  const sanitized = { ...c, models: [...c.models] };
  for (let index = 0; index < sanitized.models.length; index++) {
    const model = sanitized.models[index];
    if (model.type === "codex") {
      const updatedModel: typeof model & { baseUrl?: string } = { ...model };
      delete updatedModel.baseUrl;
      sanitized.models[index] = updatedModel;
      continue;
    }
    const provider = providerForBaseUrl(model.baseUrl);
    if (provider) {
      const envVar = getDefaultEnvVar(provider, c);
      if ("apiEnvVar" in model && envVar === model.apiEnvVar) {
        const updatedModel = { ...model };
        delete updatedModel.apiEnvVar;
        sanitized.models[index] = updatedModel;
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
        if (result.ok && result.auth.type === "apiKey") return apiKeyFromAuth(result.auth);
      }
      const result = await readAuthForBaseUrl(url, config);
      if (result.ok && result.auth.type === "apiKey") return apiKeyFromAuth(result.auth);
      return null;
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

  for (const base of SYNTHETIC_BASE_URLS) {
    const result = await readAuthForBaseUrl(base, config);
    if (result.ok && result.auth.type === "apiKey") return apiKeyFromAuth(result.auth);
  }

  return null;
}

export function readAuthForModel(
  model: CodexModelConfig,
  config: Config | null,
): Promise<CodexAuthResult>;
export function readAuthForModel(
  model: ApiKeyModelConfig,
  config: Config | null,
): Promise<ApiKeyAuthResult>;
export function readAuthForModel(model: ModelConfig, config: Config | null): Promise<AuthResult>;
export function readAuthForModel(
  model: { type?: ModelConfig["type"]; baseUrl: string; apiEnvVar?: string; auth?: Auth },
  config: Config | null,
): Promise<AuthResult>;
export async function readAuthForModel(
  model:
    | ModelConfig
    | { type?: ModelConfig["type"]; baseUrl: string; apiEnvVar?: string; auth?: Auth },
  config: Config | null,
): Promise<AuthResult> {
  if (model.type === "codex" || model.auth?.type === "codex") {
    return await resolveAuth({ type: "codex" });
  }

  if (model.auth) {
    const result = await resolveAuth(model.auth);
    if (result.ok) return result;
    // If auth is configured but failed, return the error (don't fall through)
    return result;
  }

  if (model.apiEnvVar) return await resolveAuth({ type: "env", name: model.apiEnvVar });
  if (!("baseUrl" in model)) {
    return {
      ok: false,
      error: { type: "invalid", message: "API-key model auth requires a base URL." },
    };
  }

  // Otherwise, search for auth for this model's base URL.
  return await readApiKeyAuthForBaseUrl(model.baseUrl, config);
}

export async function readAuthForBaseUrl(
  baseUrl: string,
  config: Config | null,
): Promise<AuthResult> {
  // Is it a URL for a built-in provider? Check those first
  const provider = providerForBaseUrl(baseUrl);
  if (provider) {
    if (provider.type === "codex") {
      return await resolveAuth({ type: "codex" });
    }

    const envVar = (() => {
      const key = keyFromName(provider.name);
      if (config == null) return provider.envVar;
      if (config.defaultApiKeyOverrides == null) return provider.envVar;
      if (config.defaultApiKeyOverrides[key] == null) return provider.envVar;
      return config.defaultApiKeyOverrides[key];
    })();
    if (process.env[envVar])
      return { ok: true, auth: { type: "apiKey", apiKey: process.env[envVar] } };
  }

  // Is there an entry for it in the keys file?
  const keys = await readKeys();
  if (keys[baseUrl] != null) return { ok: true, auth: { type: "apiKey", apiKey: keys[baseUrl] } };

  // Does it match an existing model with auth or API env var defined?
  for (const model of config?.models || []) {
    if (model.type !== "codex" && model.baseUrl == baseUrl) {
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

  // We can't find auth for it.
  return { ok: false, error: { type: "missing", message: `No auth found for ${baseUrl}` } };
}

async function readApiKeyAuthForBaseUrl(
  baseUrl: string,
  config: Config | null,
): Promise<ApiKeyAuthResult> {
  const provider = providerForBaseUrl(baseUrl);
  if (provider) {
    if (provider.type === "codex") {
      return {
        ok: false,
        error: { type: "missing", message: `No API key auth found for ${baseUrl}` },
      };
    }

    const envVar = (() => {
      const key = keyFromName(provider.name);
      if (config == null) return provider.envVar;
      if (config.defaultApiKeyOverrides == null) return provider.envVar;
      if (config.defaultApiKeyOverrides[key] == null) return provider.envVar;
      return config.defaultApiKeyOverrides[key];
    })();
    if (process.env[envVar])
      return { ok: true, auth: { type: "apiKey", apiKey: process.env[envVar] } };
  }

  const keys = await readKeys();
  if (keys[baseUrl] != null) return { ok: true, auth: { type: "apiKey", apiKey: keys[baseUrl] } };

  for (const model of config?.models || []) {
    if (model.type !== "codex" && model.baseUrl == baseUrl) {
      const auth = getAuthForModel(model);
      if (auth && auth.type !== "codex") {
        const result = await resolveAuth(auth);
        if (result.ok) return result;
      }
    }
  }

  if (config?.diffApply?.baseUrl === baseUrl) {
    const auth = getAuthForModel(config.diffApply);
    if (auth && auth.type !== "codex") {
      const result = await resolveAuth(auth);
      if (result.ok) return result;
    }
  }
  if (config?.fixJson?.baseUrl === baseUrl) {
    const auth = getAuthForModel(config.fixJson);
    if (auth && auth.type !== "codex") {
      const result = await resolveAuth(auth);
      if (result.ok) return result;
    }
  }

  return {
    ok: false,
    error: { type: "missing", message: `No API key auth found for ${baseUrl}` },
  };
}

// Every API base URL Synthetic has ever used
const SYNTHETIC_BASE_URLS = [
  "https://api.synthetic.new/openai/v1",
  "https://synthetic.new/api/openai/v1",
  "https://api.synthetic.new/v1",
  "https://api.glhf.chat/v1",
  "https://glhf.chat/api/v1",
  "https://glhf.chat/api/openai/v1",
];

/**
 * Checks if there's existing auth available for a given base URL.
 * For Synthetic, checks all known base URLs since they've changed over time.
 */
export async function hasExistingAuthForBaseUrl(
  baseUrl: string,
  config: Config | null,
): Promise<boolean> {
  const result = await readAuthForBaseUrl(baseUrl, config);
  if (result.ok) return true;

  if (SYNTHETIC_BASE_URLS.includes(baseUrl)) {
    for (const url of SYNTHETIC_BASE_URLS) {
      if (url !== baseUrl) {
        const syntheticResult = await readAuthForBaseUrl(url, config);
        if (syntheticResult.ok) return true;
      }
    }
  }
  return false;
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

export async function readConfig(filePath: string): Promise<Config> {
  const file = await fs.readFile(filePath, "utf8");
  const parsed = json5.parse(file.trim());
  const fileVersion: number = parsed["configVersion"] ?? 0;
  const raw = migrateConfig(parsed);
  const config = ConfigSchema.slice(raw);
  if (fileVersion < CURRENT_CONFIG_VERSION) {
    await writeConfig(config, filePath);
  }
  return config;
}

export type Metadata = {
  version: string;
};

async function readMetadata(): Promise<Metadata> {
  const packagePath = await firstExistingPath([
    path.join(__dir, "../../package.json"),
    path.join(__dir, "../package.json"),
  ]);
  const packageFile = await fs.readFile(packagePath, "utf8");
  const packageJson = JSON.parse(packageFile);

  return {
    version: packageJson["version"],
  };
}

async function firstExistingPath(paths: string[]): Promise<string> {
  for (const candidate of paths) {
    if (await fileExists(candidate)) return candidate;
  }
  return paths[0]!;
}
