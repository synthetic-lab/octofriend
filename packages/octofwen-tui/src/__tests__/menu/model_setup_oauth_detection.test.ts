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
			"../../menu/model_setup/provider-auth.ts"
		);
		const { PROVIDERS } = await import(
			"../../internal/model-provider-catalog/main.ts"
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
			"../../menu/model_setup/provider-auth.ts"
		);
		const { PROVIDERS } = await import(
			"../../internal/model-provider-catalog/main.ts"
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
			"../../menu/model_setup/provider-auth.ts"
		);
		const { PROVIDERS } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);

		expect(
			detectExistingProviderAuth(expectPresent(PROVIDERS.anthropic), null, {
				CODEX_ACCESS_TOKEN: "oauth-token",
			}),
		).toBeNull();
	});
});
