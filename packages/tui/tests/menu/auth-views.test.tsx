import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";
import { errorContext } from "../../src/menu/models/error-context.tsx";
import type { Config } from "../../src/runtime/config/schemas.ts";
import {
	PROVIDERS,
	type ProviderConfig,
} from "../../src/runtime/models/catalog/main.ts";

const oauthOnlyProvider = {
	shortcut: "o",
	type: "openai-responses",
	name: "OAuth Only",
	envVar: "OAUTH_ONLY_API_KEY",
	baseUrl: "https://oauth-only.example.test/v1",
	baseUrlAliases: [],
	apiKeyUrl: "https://oauth-only.example.test/keys",
	authMethods: ["chatgpt-oauth"],
	models: [],
	testModel: "oauth-test",
} satisfies ProviderConfig;

const noAuthProvider = {
	shortcut: "n",
	type: "standard",
	name: "No Auth",
	envVar: "NO_AUTH_API_KEY",
	baseUrl: "https://no-auth.example.test/v1",
	baseUrlAliases: [],
	apiKeyUrl: "https://no-auth.example.test/keys",
	authMethods: [],
	models: [],
	testModel: "no-auth-test",
} satisfies ProviderConfig;

function expectPresent<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("expected provider");
	return value;
}

const apiOnlyProvider = {
	shortcut: "a",
	type: "anthropic",
	name: "API Only",
	envVar: "API_ONLY_API_KEY",
	baseUrl: "https://api-only.example.test",
	baseUrlAliases: [],
	apiKeyUrl: "https://api-only.example.test/keys",
	authMethods: ["api-key"],
	models: [],
	testModel: "api-only-test",
} satisfies ProviderConfig;

describe("AuthAsk", () => {
	it("uses latest selection and back callbacks after rerender", async () => {
		const { AuthAsk } = await import("../../src/menu/models/auth-views.tsx");
		const calls: string[] = [];
		const instance = render(
			React.createElement(AuthAsk, {
				baseUrl: "https://custom.example.test/v1",
				provider: undefined,
				renderExamples: false,
				config: null,
				done: () => undefined,
				cancel: () => undefined,
				back: () => calls.push("first:back"),
				onSelect: (route) => calls.push(`first:${route}`),
			}),
		);

		instance.rerender(
			React.createElement(AuthAsk, {
				baseUrl: "https://custom.example.test/v1",
				provider: undefined,
				renderExamples: false,
				config: null,
				done: () => undefined,
				cancel: () => undefined,
				back: () => calls.push("second:back"),
				onSelect: (route) => calls.push(`second:${route}`),
			}),
		);
		instance.stdin.write("a");
		await Bun.sleep(0);
		instance.stdin.write("b");
		await Bun.sleep(0);

		expect(calls).toEqual(["second:apiKey", "second:back"]);
	});

	it("normalizes CR line breaks in auth setup dynamic copy", async () => {
		const { AuthAsk } = await import("../../src/menu/models/auth-views.tsx");
		const provider = {
			...apiOnlyProvider,
			name: "API\r\nOnly",
			envVar: "API_ONLY\rKEY",
		} satisfies ProviderConfig;

		const { lastFrame } = render(
			React.createElement(
				errorContext.Provider,
				{
					value: {
						errorMessage: "setup\r\nfailed",
						setErrorMessage: () => undefined,
					},
				},
				React.createElement(AuthAsk, {
					baseUrl: provider.baseUrl,
					provider,
					renderExamples: false,
					config: null,
					done: () => undefined,
					cancel: () => undefined,
					back: () => undefined,
					onSelect: () => undefined,
				}),
			),
		);

		const frame = lastFrame() ?? "";
		expect(frame).toContain("setup");
		expect(frame).toContain("failed");
		expect(frame).toContain("API");
		expect(frame).toContain("Only");
		expect(frame).toContain("API_ONLY");
		expect(frame).toContain("KEY");
		expect(frame).not.toContain("\r");
	});

	it("uses configured API-key env overrides in OpenAI auth setup copy", async () => {
		const { AuthAsk } = await import("../../src/menu/models/auth-views.tsx");
		const provider = expectPresent(PROVIDERS.openai);
		const config = {
			yourName: "Ada",
			models: [],
			defaultApiKeyOverrides: { openai: "OPENAI_FROM_CONFIG" },
		} satisfies Config;

		const { lastFrame } = render(
			React.createElement(AuthAsk, {
				baseUrl: provider.baseUrl,
				provider,
				renderExamples: false,
				config,
				done: () => undefined,
				cancel: () => undefined,
				back: () => undefined,
				onSelect: () => undefined,
			}),
		);

		const frame = lastFrame() ?? "";
		expect(frame).toContain(
			"Use OPENAI_FROM_CONFIG or another environment variable",
		);
		expect(frame.replace(/\s+/g, " ")).toContain(
			"Neither CODEX_ACCESS_TOKEN or legacy OPENAI_CODEX_ACCESS_TOKEN nor API-key environment variable OPENAI_FROM_CONFIG is defined",
		);
		expect(frame).not.toContain(
			"Use OPENAI_API_KEY or another environment variable",
		);
	});

	it("renders only back for providers without supported auth methods", async () => {
		const { AuthAsk } = await import("../../src/menu/models/auth-views.tsx");

		const { lastFrame } = render(
			React.createElement(AuthAsk, {
				baseUrl: noAuthProvider.baseUrl,
				provider: noAuthProvider,
				renderExamples: false,
				config: null,
				done: () => undefined,
				cancel: () => undefined,
				back: () => undefined,
				onSelect: () => undefined,
			}),
		);

		const frame = lastFrame() ?? "";
		expect(frame).toContain(
			"No Auth does not advertise a supported authentication method",
		);
		expect(frame).toContain("This provider does not advertise API-key");
		expect(frame).toContain("No supported authentication methods");
		expect(frame).toContain("Press Back and choose another provider");
		expect(frame).toContain("Back");
		expect(frame).not.toContain(
			"How do you want to authenticate with No Auth?",
		);
		expect(frame).not.toContain("Enter an API key");
		expect(frame).not.toContain("Use ChatGPT OAuth access token");
		expect(frame).not.toContain("Use an existing environment variable");
		expect(frame).not.toContain("Use a secret command");
	});

	it("renders provider-specific API-key choices for API-key providers", async () => {
		const { AuthAsk } = await import("../../src/menu/models/auth-views.tsx");

		const { lastFrame } = render(
			React.createElement(AuthAsk, {
				baseUrl: apiOnlyProvider.baseUrl,
				provider: apiOnlyProvider,
				renderExamples: false,
				config: null,
				done: () => undefined,
				cancel: () => undefined,
				back: () => undefined,
				onSelect: () => undefined,
			}),
		);

		const frame = lastFrame() ?? "";
		expect(frame).toContain("Enter API Only API key");
		expect(frame).toContain(
			"Use API_ONLY_API_KEY or another environment variable",
		);
		expect(frame).toContain("Use a secret command");
		expect(frame).not.toContain("Use ChatGPT OAuth access token");
	});

	it("renders API-key choices for custom endpoints without catalog providers", async () => {
		const { AuthAsk } = await import("../../src/menu/models/auth-views.tsx");

		const { lastFrame } = render(
			React.createElement(AuthAsk, {
				baseUrl: "https://custom.example.test/v1",
				provider: undefined,
				renderExamples: false,
				config: null,
				done: () => undefined,
				cancel: () => undefined,
				back: () => undefined,
				onSelect: () => undefined,
			}),
		);

		const frame = lastFrame() ?? "";
		const normalizedFrame = frame.replace(/\s+/g, " ");
		expect(frame).toContain("How do you want to authenticate?");
		expect(frame).toContain("Enter an API key");
		expect(frame).toContain("Use an existing environment variable");
		expect(frame).toContain("Use a secret command");
		expect(normalizedFrame).toContain(
			"This custom endpoint can use an API key, an existing environment variable, or a secret command.",
		);
		expect(frame).not.toContain("No supported authentication methods");
		expect(frame).not.toContain("does not advertise API-key");
	});

	it("only renders OAuth choices for OAuth-only providers", async () => {
		const { AuthAsk } = await import("../../src/menu/models/auth-views.tsx");

		const { lastFrame } = render(
			React.createElement(AuthAsk, {
				baseUrl: oauthOnlyProvider.baseUrl,
				provider: oauthOnlyProvider,
				renderExamples: false,
				config: null,
				done: () => undefined,
				cancel: () => undefined,
				back: () => undefined,
				onSelect: () => undefined,
			}),
		);

		const frame = lastFrame() ?? "";
		expect(frame).toContain("OAuth Only can use ChatGPT OAuth.");
		expect(frame).toContain("Use ChatGPT OAuth access token");
		expect(frame).toContain("CODEX_ACCESS_TOKEN");
		expect(frame.replace(/\s+/g, " ")).toContain(
			"OAuth token setup is available here",
		);
		expect(frame).not.toContain("does not advertise API-key");
		expect(frame).not.toContain("Enter an API key");
		expect(frame).not.toContain("Use an existing environment variable");
		expect(frame).not.toContain("Use a secret command");
	});

	it("does not read API-key override copy for OAuth-only OpenAI setup", async () => {
		const { AuthAsk } = await import("../../src/menu/models/auth-views.tsx");
		const provider = {
			...expectPresent(PROVIDERS.openai),
			authMethods: ["chatgpt-oauth"],
		} satisfies ProviderConfig;
		const config = {
			yourName: "Ada",
			models: [],
			defaultApiKeyOverrides: { openai: "OPENAI_FROM_CONFIG" },
		} satisfies Config;

		const { lastFrame } = render(
			React.createElement(AuthAsk, {
				baseUrl: provider.baseUrl,
				provider,
				renderExamples: false,
				config,
				done: () => undefined,
				cancel: () => undefined,
				back: () => undefined,
				onSelect: () => undefined,
			}),
		);

		const frame = lastFrame() ?? "";
		expect(frame).toContain("OpenAI can use ChatGPT OAuth.");
		expect(frame).toContain("Use ChatGPT OAuth access token");
		expect(frame).not.toContain("OPENAI_FROM_CONFIG");
		expect(frame).not.toContain("OPENAI_API_KEY");
		expect(frame).not.toContain("Enter OpenAI API key");
	});
});

describe("PostAuth", () => {
	it("runs terminal auth completion once across rerenders", async () => {
		const { PostAuth } = await import("../../src/menu/models/auth-views.tsx");
		const calls: string[] = [];
		const props = {
			baseUrl: "https://api.example.test/v1",
			renderExamples: false,
			config: null,
			done: () => undefined,
			cancel: () => undefined,
		};

		const instance = render(
			React.createElement(PostAuth, {
				...props,
				handleAuth: () => calls.push("first"),
			}),
		);
		instance.rerender(
			React.createElement(PostAuth, {
				...props,
				handleAuth: () => calls.push("second"),
			}),
		);
		await Bun.sleep(1);

		expect(calls).toEqual(["first"]);
	});
});
