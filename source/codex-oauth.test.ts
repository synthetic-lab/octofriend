import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function jwt(payload: unknown): string {
  return ["{}", JSON.stringify(payload), "signature"]
    .map(part => Buffer.from(part).toString("base64url"))
    .join(".");
}

describe("codex oauth", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-17T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts device authorization with the Codex client id", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      jsonResponse({
        device_auth_id: "device-1",
        user_code: "ABCD-EFGH",
        interval: "2",
      }),
    );

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

    expect(fetch).toHaveBeenCalledOnce();
    const [_url, init] = fetch.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ client_id: CODEX_OAUTH_CLIENT_ID });
  });

  it("validates malformed device authorization responses", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      jsonResponse({ user_code: "ABCD-EFGH" }),
    );

    await withMock(fetchDeps, "fetch", fetch, async () => {
      const result = await startCodexDeviceAuthorization();

      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error).toContain("Invalid Codex device authorization response");
    });
  });

  it("polls device authorization and exchanges the authorization code for tokens", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          authorization_code: "auth-code",
          code_verifier: "verifier",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          id_token: jwt({ chatgpt_account_id: "account-1" }),
        }),
      );

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

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[0][0])).toBe(
      `${CODEX_OAUTH_ISSUER}/api/accounts/deviceauth/token`,
    );
    expect(String(fetch.mock.calls[1][0])).toBe(`${CODEX_OAUTH_ISSUER}/oauth/token`);
    expect(String(fetch.mock.calls[1][1]?.body)).toContain(`client_id=${CODEX_OAUTH_CLIENT_ID}`);
  });

  it("refreshes access tokens and preserves refresh token and account id fallbacks", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
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
    const openBrowser = vi.fn(async () => true);

    await withMock(codexOAuthDeps, "openBrowser", openBrowser, async () => {
      const result = await openDefaultBrowser(CODEX_OAUTH_DEVICE_URL);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBe(true);
    });

    expect(openBrowser).toHaveBeenCalledWith(CODEX_OAUTH_DEVICE_URL);
  });
});
