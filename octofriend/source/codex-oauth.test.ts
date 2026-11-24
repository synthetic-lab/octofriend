import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test";
import { withMock } from "antipattern";
import {
  CODEX_OAUTH_CLIENT_ID,
  CODEX_OAUTH_DEVICE_URL,
  CODEX_OAUTH_ISSUER,
  codexOAuthDeps,
  openDefaultBrowser,
  pollCodexDeviceAuthorization,
  refreshCodexOAuthTokens,
  startCodexDeviceAuthorization,
} from "./codex-oauth.ts";
import { fetchDeps } from "./fetch.ts";

type FetchArgs = Parameters<typeof globalThis.fetch>;

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function asFetch(impl: (...args: FetchArgs) => Promise<Response>): typeof globalThis.fetch {
  return impl as unknown as typeof globalThis.fetch;
}

function jwt(payload: unknown): string {
  return ["{}", JSON.stringify(payload), "signature"]
    .map(part => Buffer.from(part).toString("base64url"))
    .join(".");
}

describe("codex oauth", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-17T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("starts device authorization with the Codex client id", async () => {
    const calls: FetchArgs[] = [];
    const fetch = asFetch(async (...args: FetchArgs) => {
      calls.push(args);
      return jsonResponse({
        device_auth_id: "device-1",
        user_code: "ABCD-EFGH",
        interval: "2",
      });
    });

    await withMock(fetchDeps, "fetch", fetch, async () => {
      const result = await startCodexDeviceAuthorization();

      expect(result.success).toBe(true);
      if (result.success)
        expect(result.data).toEqual({
          deviceAuthId: "device-1",
          userCode: "ABCD-EFGH",
          verificationUri: CODEX_OAUTH_DEVICE_URL,
          intervalMs: 2000,
        });
    });

    expect(calls).toHaveLength(1);
    const [_url, init] = calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ client_id: CODEX_OAUTH_CLIENT_ID });
  });

  it("validates malformed device authorization responses", async () => {
    const fetch = asFetch(async () => jsonResponse({ user_code: "ABCD-EFGH" }));

    await withMock(fetchDeps, "fetch", fetch, async () => {
      const result = await startCodexDeviceAuthorization();

      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error).toContain("Invalid Codex device authorization response");
    });
  });

  it("polls device authorization and exchanges the authorization code for tokens", async () => {
    const responses = [
      jsonResponse({
        authorization_code: "auth-code",
        code_verifier: "verifier",
      }),
      jsonResponse({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        id_token: jwt({ chatgpt_account_id: "account-1" }),
      }),
    ];
    const calls: FetchArgs[] = [];
    const fetch = asFetch(async (...args: FetchArgs) => {
      calls.push(args);
      return responses.shift()!;
    });

    await withMock(fetchDeps, "fetch", fetch, async () => {
      const result = await pollCodexDeviceAuthorization({
        deviceAuthId: "device-1",
        userCode: "ABCD-EFGH",
        verificationUri: CODEX_OAUTH_DEVICE_URL,
        intervalMs: 1000,
      });

      expect(result.success).toBe(true);
      if (result.success)
        expect(result.data).toEqual({
          access: "access-token",
          refresh: "refresh-token",
          expires: Date.parse("2026-06-17T01:00:00.000Z"),
          accountId: "account-1",
        });
    });

    expect(calls).toHaveLength(2);
    expect(String(calls[0]![0])).toBe(`${CODEX_OAUTH_ISSUER}/api/accounts/deviceauth/token`);
    expect(String(calls[1]![0])).toBe(`${CODEX_OAUTH_ISSUER}/oauth/token`);
    expect(String(calls[1]![1]?.body)).toContain(`client_id=${CODEX_OAUTH_CLIENT_ID}`);
  });

  it("refreshes access tokens and preserves refresh token and account id fallbacks", async () => {
    const fetch = asFetch(async () =>
      jsonResponse({
        access_token: "new-access-token",
        expires_in: 1800,
      }),
    );

    await withMock(fetchDeps, "fetch", fetch, async () => {
      const result = await refreshCodexOAuthTokens({
        access: "old-access-token",
        refresh: "refresh-token",
        expires: Date.parse("2026-06-16T23:00:00.000Z"),
        accountId: "account-1",
      });

      expect(result.success).toBe(true);
      if (result.success)
        expect(result.data).toEqual({
          access: "new-access-token",
          refresh: "refresh-token",
          expires: Date.parse("2026-06-17T00:30:00.000Z"),
          accountId: "account-1",
        });
    });
  });

  it("opens the browser through the mockable browser dependency", async () => {
    const openBrowserCalls: string[] = [];
    const openBrowser = async (url: string) => {
      openBrowserCalls.push(url);
      return true;
    };

    await withMock(codexOAuthDeps, "openBrowser", openBrowser, async () => {
      const result = await openDefaultBrowser(CODEX_OAUTH_DEVICE_URL);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBe(true);
    });

    expect(openBrowserCalls).toEqual([CODEX_OAUTH_DEVICE_URL]);
  });
});
