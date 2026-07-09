import { describe, expect, it } from "bun:test";
import { PROVIDERS } from "../../internal/model-provider-catalog/main.ts";
import {
	apiKeyEnvAuth,
	authChoicesForProvider,
	chatGptOAuthEnvAuth,
	defaultApiKeyOverrideForProviderAuth,
	detectExistingProviderAuth,
	providerAuthText,
	shouldPersistDefaultApiKeyOverride,
} from "../../menu/model_setup/provider-auth.ts";
import { expectPresent } from "./test-support.ts";

describe("provider auth helpers", () => {
	it("does not report auth support when no provider is selected", () => {
		expect(authChoicesForProvider(null)).toEqual({
			supportsApiKey: false,
			supportsChatGptOAuth: false,
		});
		expect(authChoicesForProvider(undefined)).toEqual({
			supportsApiKey: false,
			supportsChatGptOAuth: false,
		});
	});

	it("does not report API-key support for providers with an explicit empty auth method list", () => {
		expect(authChoicesForProvider({ authMethods: [] })).toEqual({
			supportsApiKey: false,
			supportsChatGptOAuth: false,
		});
		expect(providerAuthText({ authMethods: [] })).toBe(
			"no supported authentication methods",
		);
	});

	it("keeps built-in provider auth choices aligned with setup requirements", () => {
		expect(authChoicesForProvider(expectPresent(PROVIDERS.openai))).toEqual({
			supportsApiKey: true,
			supportsChatGptOAuth: true,
		});
		for (const provider of [
			expectPresent(PROVIDERS.synthetic),
			expectPresent(PROVIDERS.anthropic),
			expectPresent(PROVIDERS.gemini),
		]) {
			expect(authChoicesForProvider(provider)).toEqual({
				supportsApiKey: true,
				supportsChatGptOAuth: false,
			});
		}
	});

	it("keeps built-in provider auth method lists exact for setup routing", () => {
		expect(expectPresent(PROVIDERS.openai).authMethods).toEqual([
			"chatgpt-oauth",
			"api-key",
		]);
		expect(expectPresent(PROVIDERS.synthetic).authMethods).toEqual(["api-key"]);
		expect(expectPresent(PROVIDERS.anthropic).authMethods).toEqual(["api-key"]);
		expect(expectPresent(PROVIDERS.gemini).authMethods).toEqual(["api-key"]);
	});

	it("builds distinct env auth records for API keys and ChatGPT OAuth", () => {
		expect(apiKeyEnvAuth("OPENAI_API_KEY")).toEqual({
			type: "env",
			name: "OPENAI_API_KEY",
			credential: "api-key",
		});
		expect(chatGptOAuthEnvAuth("CODEX_ACCESS_TOKEN")).toEqual({
			type: "env",
			name: "CODEX_ACCESS_TOKEN",
			credential: "chatgpt-oauth",
		});
	});

	it("keeps ChatGPT OAuth env auth out of default API-key overrides", () => {
		expect(
			shouldPersistDefaultApiKeyOverride({
				type: "env",
				name: "CODEX_ACCESS_TOKEN",
				credential: "chatgpt-oauth",
			}),
		).toBe(false);
		expect(
			shouldPersistDefaultApiKeyOverride({
				type: "env",
				name: "FUTURE_TOKEN",
				credential: "future-token",
			} as unknown as import("../../internal/configuration/schemas.ts").Auth),
		).toBe(false);
		expect(
			shouldPersistDefaultApiKeyOverride({
				type: "env",
				name: "OPENAI_API_KEY",
			}),
		).toBe(true);
		expect(
			shouldPersistDefaultApiKeyOverride({
				type: "command",
				command: ["op", "read", "secret"],
			}),
		).toBe(false);
	});

	it("builds default API-key override records only for provider API-key env auth", () => {
		expect(
			defaultApiKeyOverrideForProviderAuth(
				{ name: "OpenAI" },
				{ type: "env", name: "OPENAI_API_KEY" },
			),
		).toEqual({ openai: "OPENAI_API_KEY" });
		expect(
			defaultApiKeyOverrideForProviderAuth(
				{ name: "OpenAI" },
				{ type: "env", name: "  OPENAI_API_KEY\n" },
			),
		).toEqual({ openai: "OPENAI_API_KEY" });
		expect(
			defaultApiKeyOverrideForProviderAuth(
				{ name: "OpenAI" },
				{ type: "env", name: " \t\n" },
			),
		).toBeNull();
		expect(
			defaultApiKeyOverrideForProviderAuth(
				{ name: "OpenAI" },
				{
					type: "env",
					name: "CODEX_ACCESS_TOKEN",
					credential: "chatgpt-oauth",
				},
			),
		).toBeNull();
		expect(
			defaultApiKeyOverrideForProviderAuth(
				{ name: "Custom Provider" },
				{ type: "env", name: "CUSTOM_API_KEY" },
			),
		).toBeNull();
	});

	it("does not auto-detect env auth for providers without supported auth methods", () => {
		const openai = expectPresent(PROVIDERS.openai);
		expect(
			detectExistingProviderAuth(
				{
					...openai,
					name: "Internal",
					envVar: "INTERNAL_API_KEY",
					authMethods: [],
				},
				null,
				{
					INTERNAL_API_KEY: "present",
					CODEX_ACCESS_TOKEN: "oauth",
				},
			),
		).toBeNull();
	});

	it("does not auto-detect ChatGPT OAuth for API-key-only providers", () => {
		for (const provider of [
			expectPresent(PROVIDERS.synthetic),
			expectPresent(PROVIDERS.anthropic),
			expectPresent(PROVIDERS.gemini),
		]) {
			expect(
				detectExistingProviderAuth(provider, null, {
					[provider.envVar]: undefined,
					CODEX_ACCESS_TOKEN: "oauth",
				}),
			).toBeNull();
		}
	});

	it("respects provider auth method order during auto-detection", () => {
		const openai = expectPresent(PROVIDERS.openai);
		expect(
			detectExistingProviderAuth(
				{ ...openai, authMethods: ["api-key", "chatgpt-oauth"] },
				null,
				{
					OPENAI_API_KEY: "api-key",
					CODEX_ACCESS_TOKEN: "oauth",
				},
			),
		).toEqual({ overrideAuth: null, useEnvVar: true });
	});

	it("auto-detects ChatGPT OAuth first for the built-in OpenAI provider", () => {
		const openai = expectPresent(PROVIDERS.openai);
		expect(
			detectExistingProviderAuth(openai, null, {
				OPENAI_API_KEY: "api-key",
				CODEX_ACCESS_TOKEN: "oauth",
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

	it("detects legacy octofriend OpenAI OAuth env vars for OpenAI setup", () => {
		const openai = expectPresent(PROVIDERS.openai);
		expect(
			detectExistingProviderAuth(openai, null, {
				OPENAI_CODEX_ACCESS_TOKEN: "legacy-oauth",
			}),
		).toEqual({
			overrideAuth: {
				type: "env",
				name: "OPENAI_CODEX_ACCESS_TOKEN",
				credential: "chatgpt-oauth",
			},
			useEnvVar: false,
		});
	});
});
