import fs from "fs/promises";
import os from "os";
import path from "path";
import { setTimeout as sleep } from "node:timers/promises";
import json5 from "json5";
import { t } from "structural";
import { registry } from "antipattern";
import { fileExists } from "./fs-utils.ts";
import { spawnBrowser } from "./browser-spawn.ts";
import { fetchDeps } from "./fetch.ts";
import { err, errorToString, ok } from "./libocto/result.ts";
import type { Result } from "./libocto/result.ts";

export const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CODEX_OAUTH_ISSUER = "https://auth.openai.com";
export const CODEX_OAUTH_DEVICE_URL = `${CODEX_OAUTH_ISSUER}/codex/device`;

const CONFIG_DIR = path.join(os.homedir(), ".config/octofriend");
export const CODEX_OAUTH_FILE = path.join(CONFIG_DIR, "oauth.json5");
const ACCESS_TOKEN_REFRESH_MARGIN_MS = 60 * 1000;
const DEVICE_POLLING_SAFETY_MARGIN_MS = 3000;

export const codexOAuthDeps = registry({
  openBrowser(url: string) {
    return spawnBrowser(url);
  },
});

const CodexOAuthTokensSchema = t.subtype({
  access: t.str,
  refresh: t.str,
  expires: t.num,
  accountId: t.optional(t.str),
});
const OAuthConfigSchema = t.subtype({
  codex: t.optional(CodexOAuthTokensSchema),
});

export type CodexOAuthTokens = t.GetType<typeof CodexOAuthTokensSchema>;
type OAuthConfig = t.GetType<typeof OAuthConfigSchema>;

export type CodexDeviceAuthorization = {
  deviceAuthId: string;
  userCode: string;
  verificationUri: string;
  intervalMs: number;
};

const DeviceCodeResponseSchema = t.subtype({
  device_auth_id: t.str,
  user_code: t.str,
  interval: t.optional(t.str.or(t.num)),
});
type DeviceCodeResponse = t.GetType<typeof DeviceCodeResponseSchema>;

const DeviceTokenResponseSchema = t.subtype({
  authorization_code: t.str,
  code_verifier: t.str,
});
type DeviceTokenResponse = t.GetType<typeof DeviceTokenResponseSchema>;

const CodexTokenResponseSchema = t.subtype({
  access_token: t.str,
  refresh_token: t.optional(t.str),
  id_token: t.optional(t.str),
  expires_in: t.optional(t.num),
});
type CodexTokenResponse = t.GetType<typeof CodexTokenResponseSchema>;

export type CodexIdTokenClaims = {
  chatgpt_account_id?: string;
  organizations?: Array<{ id: string }>;
  email?: string;
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string;
  };
};

export async function readCodexOAuthTokens(): Promise<Result<CodexOAuthTokens | null, string>> {
  const config = await readOAuthConfig();
  if (!config.success) return config;
  return ok(config.data.codex ?? null);
}

export async function writeCodexOAuthTokens(
  tokens: CodexOAuthTokens,
): Promise<Result<void, string>> {
  const config = await readOAuthConfig();
  if (!config.success) return config;

  config.data.codex = tokens;
  return await writeOAuthConfig(config.data);
}

export async function getCodexOAuthTokens(): Promise<Result<CodexOAuthTokens | null, string>> {
  const tokens = await readCodexOAuthTokens();
  if (!tokens.success) return tokens;
  if (!tokens.data) return ok(null);
  if (tokens.data.expires > Date.now() + ACCESS_TOKEN_REFRESH_MARGIN_MS) return tokens;

  const refreshed = await refreshCodexOAuthTokens(tokens.data);
  if (!refreshed.success) return refreshed;

  const written = await writeCodexOAuthTokens(refreshed.data);
  if (!written.success) return written;

  return ok(refreshed.data);
}

export async function hasCodexOAuthTokens(): Promise<boolean> {
  const tokens = await getCodexOAuthTokens();
  return tokens.success && tokens.data != null;
}

export async function startCodexDeviceAuthorization(): Promise<
  Result<CodexDeviceAuthorization, string>
> {
  const response = await captureAsync("Codex device authorization request failed", () =>
    fetchDeps.fetch(`${CODEX_OAUTH_ISSUER}/api/accounts/deviceauth/usercode`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "octofriend",
      },
      body: JSON.stringify({ client_id: CODEX_OAUTH_CLIENT_ID }),
    }),
  );
  if (!response.success) return response;

  if (!response.data.ok) {
    return err(`Codex device authorization failed: ${await responseError(response.data)}`);
  }

  const body = await responseJson(response.data, "Codex device authorization response");
  if (!body.success) return body;

  const data = parseDeviceCodeResponse(body.data);
  if (!data.success) return data;

  const interval = Number(data.data.interval ?? 5);

  return ok({
    deviceAuthId: data.data.device_auth_id,
    userCode: data.data.user_code,
    verificationUri: CODEX_OAUTH_DEVICE_URL,
    intervalMs: Math.max(Number.isFinite(interval) ? interval : 5, 1) * 1000,
  });
}

export async function openDefaultBrowser(url: string): Promise<Result<boolean, string>> {
  return await captureAsync("Opening the browser failed", () => codexOAuthDeps.openBrowser(url));
}

export async function pollCodexDeviceAuthorization(
  device: CodexDeviceAuthorization,
  signal?: AbortSignal,
): Promise<Result<CodexOAuthTokens, string>> {
  while (!signal?.aborted) {
    const response = await captureAsync("Codex device authorization polling failed", () =>
      fetchDeps.fetch(`${CODEX_OAUTH_ISSUER}/api/accounts/deviceauth/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "octofriend",
        },
        body: JSON.stringify({
          device_auth_id: device.deviceAuthId,
          user_code: device.userCode,
        }),
        signal,
      }),
    );
    if (!response.success) {
      if (signal?.aborted) return err("Codex OAuth authorization was cancelled.");
      return response;
    }

    if (response.data.ok) {
      const body = await responseJson(response.data, "Codex device authorization token response");
      if (!body.success) return body;

      const data = parseDeviceTokenResponse(body.data);
      if (!data.success) return data;

      return await exchangeCodexAuthorizationCode(
        data.data.authorization_code,
        data.data.code_verifier,
        {
          requireRefreshToken: true,
        },
      );
    }

    if (response.data.status !== 403 && response.data.status !== 404) {
      return err(`Codex device authorization failed: ${await responseError(response.data)}`);
    }

    const slept = await captureAsync("Codex device authorization polling failed", () =>
      sleep(device.intervalMs + DEVICE_POLLING_SAFETY_MARGIN_MS, undefined, { signal }),
    );
    if (!slept.success) {
      if (signal?.aborted) return err("Codex OAuth authorization was cancelled.");
      return slept;
    }
  }

  return err("Codex OAuth authorization was cancelled.");
}

export async function refreshCodexOAuthTokens(
  tokens: CodexOAuthTokens,
): Promise<Result<CodexOAuthTokens, string>> {
  const response = await captureAsync("Codex token refresh request failed", () =>
    fetchDeps.fetch(`${CODEX_OAUTH_ISSUER}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh,
        client_id: CODEX_OAUTH_CLIENT_ID,
      }).toString(),
    }),
  );
  if (!response.success) return response;

  if (!response.data.ok) {
    return err(`Codex token refresh failed: ${await responseError(response.data)}`);
  }

  const body = await responseJson(response.data, "Codex token refresh response");
  if (!body.success) return body;

  const refreshed = parseTokenResponse(body.data);
  if (!refreshed.success) return refreshed;

  return tokensFromResponse(refreshed.data, {
    fallbackRefreshToken: tokens.refresh,
    fallbackAccountId: tokens.accountId,
  });
}

export function parseJwtClaims(token: string): CodexIdTokenClaims | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;

  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString()) as CodexIdTokenClaims;
  } catch {
    return undefined;
  }
}

export function extractAccountIdFromClaims(claims: CodexIdTokenClaims): string | undefined {
  return (
    claims.chatgpt_account_id ||
    claims["https://api.openai.com/auth"]?.chatgpt_account_id ||
    claims.organizations?.[0]?.id
  );
}

async function exchangeCodexAuthorizationCode(
  authorizationCode: string,
  codeVerifier: string,
  options: { requireRefreshToken: boolean },
): Promise<Result<CodexOAuthTokens, string>> {
  const response = await captureAsync("Codex token exchange request failed", () =>
    fetchDeps.fetch(`${CODEX_OAUTH_ISSUER}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: authorizationCode,
        redirect_uri: `${CODEX_OAUTH_ISSUER}/deviceauth/callback`,
        client_id: CODEX_OAUTH_CLIENT_ID,
        code_verifier: codeVerifier,
      }).toString(),
    }),
  );
  if (!response.success) return response;

  if (!response.data.ok) {
    return err(`Codex token exchange failed: ${await responseError(response.data)}`);
  }

  const body = await responseJson(response.data, "Codex token exchange response");
  if (!body.success) return body;

  const parsed = parseTokenResponse(body.data);
  if (!parsed.success) return parsed;

  return tokensFromResponse(parsed.data, {
    requireRefreshToken: options.requireRefreshToken,
  });
}

async function readOAuthConfig(): Promise<Result<OAuthConfig, string>> {
  const exists = await captureAsync(`Failed to check ${CODEX_OAUTH_FILE}`, () =>
    fileExists(CODEX_OAUTH_FILE),
  );
  if (!exists.success) return exists;
  if (!exists.data) return ok({});

  const file = await captureAsync(`Failed to read ${CODEX_OAUTH_FILE}`, () =>
    fs.readFile(CODEX_OAUTH_FILE, "utf8"),
  );
  if (!file.success) return file;

  const parsed = capture(`Invalid JSON5 in ${CODEX_OAUTH_FILE}`, () => json5.parse(file.data));
  if (!parsed.success) return parsed;

  return capture(`Invalid OAuth config in ${CODEX_OAUTH_FILE}`, () =>
    OAuthConfigSchema.slice(parsed.data),
  );
}

async function writeOAuthConfig(config: OAuthConfig): Promise<Result<void, string>> {
  const mkdir = await captureAsync(`Failed to create ${CONFIG_DIR}`, () =>
    fs.mkdir(CONFIG_DIR, { recursive: true }),
  );
  if (!mkdir.success) return err(mkdir.error);

  return await captureAsync(`Failed to write ${CODEX_OAUTH_FILE}`, () =>
    fs.writeFile(CODEX_OAUTH_FILE, json5.stringify(config, null, 2), { mode: 0o600 }),
  );
}

function tokensFromResponse(
  response: CodexTokenResponse,
  options: {
    fallbackRefreshToken?: string;
    fallbackAccountId?: string;
    requireRefreshToken?: boolean;
  } = {},
): Result<CodexOAuthTokens, string> {
  const refresh = response.refresh_token ?? options.fallbackRefreshToken;
  if (!refresh && options.requireRefreshToken) {
    return err("Codex token response did not include a refresh token.");
  }
  if (!refresh) return err("Codex refresh token is missing.");

  const accountId =
    extractAccountId(response.id_token) ||
    extractAccountId(response.access_token) ||
    options.fallbackAccountId;

  return ok({
    access: response.access_token,
    refresh,
    expires: Date.now() + (response.expires_in ?? 3600) * 1000,
    ...(accountId ? { accountId } : {}),
  });
}

function extractAccountId(token: string | undefined): string | undefined {
  if (!token) return undefined;
  const claims = parseJwtClaims(token);
  return claims ? extractAccountIdFromClaims(claims) : undefined;
}

function parseTokenResponse(value: unknown): Result<CodexTokenResponse, string> {
  return capture("Invalid Codex token response", () => CodexTokenResponseSchema.slice(value));
}

function parseDeviceCodeResponse(value: unknown): Result<DeviceCodeResponse, string> {
  return capture("Invalid Codex device authorization response", () =>
    DeviceCodeResponseSchema.slice(value),
  );
}

function parseDeviceTokenResponse(value: unknown): Result<DeviceTokenResponse, string> {
  return capture("Invalid Codex device authorization token response", () =>
    DeviceTokenResponseSchema.slice(value),
  );
}

async function responseError(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  const suffix = body ? `: ${body.slice(0, 500)}` : "";
  return `${response.status} ${response.statusText}${suffix}`;
}

async function responseJson(response: Response, context: string): Promise<Result<unknown, string>> {
  return await captureAsync(`Failed to parse ${context}`, () => response.json());
}

function capture<T>(context: string, callback: () => T): Result<T, string> {
  try {
    return ok(callback());
  } catch (error) {
    return err(`${context}: ${errorToString(error)}`);
  }
}

async function captureAsync<T>(
  context: string,
  callback: () => Promise<T>,
): Promise<Result<T, string>> {
  try {
    return ok(await callback());
  } catch (error) {
    return err(`${context}: ${errorToString(error)}`);
  }
}
