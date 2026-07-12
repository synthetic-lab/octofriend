import { describe, expect, it } from "bun:test";

function expectPresent<T>(value: T): NonNullable<T> {
	if (value === null || value === undefined) {
		throw new Error("Expected value to be present");
	}
	return value;
}

describe("provider OAuth auto-detection", () => {
	it("uses an existing ChatGPT OAuth token for OpenAI setup without treating it as an API-key override", async () => {
		const { detectExistingProviderAuth } = await import(
			"../../src/menu/models/auth.ts"
		);
		const { PROVIDERS } = await import(
			"../../src/runtime/models/catalog/main.ts"
		);

		expect(
			detectExistingProviderAuth(expectPresent(PROVIDERS.openai), null, {
				CODEX_ACCESS_TOKEN: "oauth-token",
			}),
		).toEqual({
			overrideAuth: {
				type: "env",
				name: "CODEX_ACCESS_TOKEN",
				credential: "chatgpt-oauth",
			},
			useEnvVar: false,
		});
	});

	it("prefers ChatGPT OAuth for OpenAI when both configured auth env vars are present", async () => {
		const { detectExistingProviderAuth } = await import(
			"../../src/menu/models/auth.ts"
		);
		const { PROVIDERS } = await import(
			"../../src/runtime/models/catalog/main.ts"
		);

		expect(
			detectExistingProviderAuth(expectPresent(PROVIDERS.openai), null, {
				OPENAI_API_KEY: "api-key",
				CODEX_ACCESS_TOKEN: "oauth-token",
			}),
		).toEqual({
			overrideAuth: {
				type: "env",
				name: "CODEX_ACCESS_TOKEN",
				credential: "chatgpt-oauth",
			},
			useEnvVar: false,
		});
	});

	it("does not use ChatGPT OAuth tokens for API-key-only providers", async () => {
		const { detectExistingProviderAuth } = await import(
			"../../src/menu/models/auth.ts"
		);
		const { PROVIDERS } = await import(
			"../../src/runtime/models/catalog/main.ts"
		);

		expect(
			detectExistingProviderAuth(expectPresent(PROVIDERS.anthropic), null, {
				CODEX_ACCESS_TOKEN: "oauth-token",
			}),
		).toBeNull();
	});
});

describe("ChatGPT OAuth token claims", () => {
	it("extracts account ids from supported JWT claim layouts", async () => {
		const { extractCodexAccountId, parseCodexJwtClaims } = await import(
			"../../src/menu/models/codex-oauth.ts"
		);
		const token = [
			Buffer.from("{}").toString("base64url"),
			Buffer.from(
				JSON.stringify({
					"https://api.openai.com/auth": {
						chatgpt_account_id: "account-123",
					},
				}),
			).toString("base64url"),
			"signature",
		].join(".");
		const claims = parseCodexJwtClaims(token);
		expect(claims).toBeDefined();
		expect(extractCodexAccountId(expectPresent(claims))).toBe("account-123");
	});

	it("rejects malformed JWT payloads without throwing", async () => {
		const { parseCodexJwtClaims } = await import(
			"../../src/menu/models/codex-oauth.ts"
		);
		expect(parseCodexJwtClaims("not-a-jwt")).toBeUndefined();
		expect(parseCodexJwtClaims("e30.invalid.signature")).toBeUndefined();
	});
});

describe("ChatGPT OAuth errors", () => {
	it("formats structured provider errors instead of displaying [object Object]", async () => {
		const { formatCodexOAuthError } = await import(
			"../../src/menu/models/codex-oauth.ts"
		);

		expect(
			formatCodexOAuthError({ error: { message: "authorization expired" } }),
		).toBe("authorization expired");
		expect(formatCodexOAuthError({ code: "access_denied" })).toBe(
			'{"code":"access_denied"}',
		);
	});
});
