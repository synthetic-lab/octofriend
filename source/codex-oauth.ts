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

export async function readCodexOAuthTokens(): Promise<CodexOAuthTokens | null> {
  const config = await readOAuthConfig();
  return config.codex ?? null;
}

export async function writeCodexOAuthTokens(tokens: CodexOAuthTokens): Promise<void> {
  const config = await readOAuthConfig();
  config.codex = tokens;
  await writeOAuthConfig(config);
}

export async function getCodexOAuthTokens(): Promise<CodexOAuthTokens | null> {
  try {
    const tokens = await readCodexOAuthTokens();
    if (!tokens) return null;
    if (tokens.expires > Date.now() + ACCESS_TOKEN_REFRESH_MARGIN_MS) return tokens;

    const refreshed = await refreshCodexOAuthTokens(tokens);
    await writeCodexOAuthTokens(refreshed);
    return refreshed;
  } catch {
    return null;
  }
}

export async function hasCodexOAuthTokens(): Promise<boolean> {
  return (await getCodexOAuthTokens()) != null;
}

export async function startCodexDeviceAuthorization(): Promise<CodexDeviceAuthorization> {
  const response = await fetchDeps.fetch(`${CODEX_OAUTH_ISSUER}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "octofriend",
    },
    body: JSON.stringify({ client_id: CODEX_OAUTH_CLIENT_ID }),
  });

  if (!response.ok) {
    throw new Error(`Codex device authorization failed: ${await responseError(response)}`);
  }

  const data = parseDeviceCodeResponse(await response.json());
  const interval = Number(data.interval ?? 5);

  return {
    deviceAuthId: data.device_auth_id,
    userCode: data.user_code,
    verificationUri: CODEX_OAUTH_DEVICE_URL,
    intervalMs: Math.max(Number.isFinite(interval) ? interval : 5, 1) * 1000,
  };
}

export async function openDefaultBrowser(url: string): Promise<boolean> {
  return await codexOAuthDeps.openBrowser(url);
}

export async function pollCodexDeviceAuthorization(
  device: CodexDeviceAuthorization,
  signal?: AbortSignal,
): Promise<CodexOAuthTokens> {
  while (!signal?.aborted) {
    const response = await fetchDeps.fetch(`${CODEX_OAUTH_ISSUER}/api/accounts/deviceauth/token`, {
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
    });

    if (response.ok) {
      const data = parseDeviceTokenResponse(await response.json());
      return await exchangeCodexAuthorizationCode(data.authorization_code, data.code_verifier, {
        requireRefreshToken: true,
      });
    }

    if (response.status !== 403 && response.status !== 404) {
      throw new Error(`Codex device authorization failed: ${await responseError(response)}`);
    }

    await sleep(device.intervalMs + DEVICE_POLLING_SAFETY_MARGIN_MS, undefined, { signal });
  }

  throw new Error("Codex OAuth authorization was cancelled.");
}

export async function refreshCodexOAuthTokens(tokens: CodexOAuthTokens): Promise<CodexOAuthTokens> {
  const response = await fetchDeps.fetch(`${CODEX_OAUTH_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh,
      client_id: CODEX_OAUTH_CLIENT_ID,
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`Codex token refresh failed: ${await responseError(response)}`);
  }

  const refreshed = parseTokenResponse(await response.json());
  return tokensFromResponse(refreshed, {
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
): Promise<CodexOAuthTokens> {
  const response = await fetchDeps.fetch(`${CODEX_OAUTH_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: authorizationCode,
      redirect_uri: `${CODEX_OAUTH_ISSUER}/deviceauth/callback`,
      client_id: CODEX_OAUTH_CLIENT_ID,
      code_verifier: codeVerifier,
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`Codex token exchange failed: ${await responseError(response)}`);
  }

  const tokens = tokensFromResponse(parseTokenResponse(await response.json()), {
    requireRefreshToken: options.requireRefreshToken,
  });
  return tokens;
}

async function readOAuthConfig(): Promise<OAuthConfig> {
  if (!(await fileExists(CODEX_OAUTH_FILE))) return {};
  const file = await fs.readFile(CODEX_OAUTH_FILE, "utf8");
  return OAuthConfigSchema.slice(json5.parse(file));
}

async function writeOAuthConfig(config: OAuthConfig): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CODEX_OAUTH_FILE, json5.stringify(config, null, 2), { mode: 0o600 });
}

function tokensFromResponse(
  response: CodexTokenResponse,
  options: {
    fallbackRefreshToken?: string;
    fallbackAccountId?: string;
    requireRefreshToken?: boolean;
  } = {},
): CodexOAuthTokens {
  const refresh = response.refresh_token ?? options.fallbackRefreshToken;
  if (!refresh && options.requireRefreshToken) {
    throw new Error("Codex token response did not include a refresh token.");
  }
  if (!refresh) throw new Error("Codex refresh token is missing.");

  const accountId =
    extractAccountId(response.id_token) ||
    extractAccountId(response.access_token) ||
    options.fallbackAccountId;

  return {
    access: response.access_token,
    refresh,
    expires: Date.now() + (response.expires_in ?? 3600) * 1000,
    ...(accountId ? { accountId } : {}),
  };
}

function extractAccountId(token: string | undefined): string | undefined {
  if (!token) return undefined;
  const claims = parseJwtClaims(token);
  return claims ? extractAccountIdFromClaims(claims) : undefined;
}

function parseTokenResponse(value: unknown): CodexTokenResponse {
  return CodexTokenResponseSchema.slice(value);
}

function parseDeviceCodeResponse(value: unknown): DeviceCodeResponse {
  return DeviceCodeResponseSchema.slice(value);
}

function parseDeviceTokenResponse(value: unknown): DeviceTokenResponse {
  return DeviceTokenResponseSchema.slice(value);
}

async function responseError(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  const suffix = body ? `: ${body.slice(0, 500)}` : "";
  return `${response.status} ${response.statusText}${suffix}`;
}
