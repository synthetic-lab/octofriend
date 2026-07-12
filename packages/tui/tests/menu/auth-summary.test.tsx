import { describe, expect, it } from "bun:test";
import { PROVIDERS } from "../../src/runtime/models/catalog/main.ts";

function expectPresent<T>(value: T): NonNullable<T> {
	if (value === null || value === undefined) {
		throw new Error("Expected value to be present");
	}
	return value;
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Timed out waiting for condition");
}

describe("provider setup summary", () => {
	it("maps provider authentication and base URL override env vars from the catalog", async () => {
		const { providerSetupSummaryLines } = await import(
			"../../src/menu/models/auth-summary.tsx"
		);
		expect(
			providerSetupSummaryLines(
				[
					["openai", expectPresent(PROVIDERS.openai)],
					["anthropic", expectPresent(PROVIDERS.anthropic)],
					["gemini", expectPresent(PROVIDERS.gemini)],
					["synthetic", expectPresent(PROVIDERS.synthetic)],
				],
				{},
			),
		).toEqual([
			"OpenAI: ChatGPT OAuth via CODEX_ACCESS_TOKEN (missing); API key via OPENAI_API_KEY (missing); OPENAI_BASE_URL can override https://api.openai.com/v1",
			"Anthropic: API key via ANTHROPIC_API_KEY (missing); ANTHROPIC_BASE_URL can override https://api.anthropic.com",
			"Google Gemini: API key via GEMINI_API_KEY (missing); GEMINI_BASE_URL can override https://generativelanguage.googleapis.com/v1beta",
			"Synthetic: API key via SYNTHETIC_API_KEY (missing); SYNTHETIC_BASE_URL can override https://api.synthetic.new/v1",
		]);
	});

	it("marks configured auth env vars as detected when present", async () => {
		const { providerSetupSummaryLines } = await import(
			"../../src/menu/models/auth-summary.tsx"
		);
		expect(
			providerSetupSummaryLines(
				[
					["openai", expectPresent(PROVIDERS.openai)],
					["anthropic", expectPresent(PROVIDERS.anthropic)],
				],
				{
					CODEX_ACCESS_TOKEN: "oauth-token",
					OPENAI_FROM_CONFIG: "api-key",
					ANTHROPIC_API_KEY: "anthropic-key",
				},
				{ defaultApiKeyOverrides: { openai: "OPENAI_FROM_CONFIG" } },
			),
		).toEqual([
			"OpenAI: ChatGPT OAuth via CODEX_ACCESS_TOKEN (detected); API key via OPENAI_FROM_CONFIG (detected); OPENAI_BASE_URL can override https://api.openai.com/v1",
			"Anthropic: API key via ANTHROPIC_API_KEY (detected); ANTHROPIC_BASE_URL can override https://api.anthropic.com",
		]);
	});

	it("marks legacy octofriend OpenAI OAuth env vars as detected", async () => {
		const { providerSetupSummaryLines } = await import(
			"../../src/menu/models/auth-summary.tsx"
		);
		expect(
			providerSetupSummaryLines([["openai", expectPresent(PROVIDERS.openai)]], {
				OPENAI_CODEX_ACCESS_TOKEN: "legacy-oauth-token",
			}),
		).toEqual([
			"OpenAI: ChatGPT OAuth via CODEX_ACCESS_TOKEN (detected via OPENAI_CODEX_ACCESS_TOKEN); API key via OPENAI_API_KEY (missing); OPENAI_BASE_URL can override https://api.openai.com/v1",
		]);
	});

	it("uses configured API-key overrides in provider setup summaries", async () => {
		const { providerSetupSummaryLines } = await import(
			"../../src/menu/models/auth-summary.tsx"
		);
		const config = {
			defaultApiKeyOverrides: {
				openai: "OPENAI_FROM_CONFIG",
				anthropic: "ANTHROPIC_FROM_CONFIG",
			},
		};

		expect(
			providerSetupSummaryLines(
				[
					["openai", expectPresent(PROVIDERS.openai)],
					["anthropic", expectPresent(PROVIDERS.anthropic)],
				],
				{},
				config,
			),
		).toEqual([
			"OpenAI: ChatGPT OAuth via CODEX_ACCESS_TOKEN (missing); API key via OPENAI_FROM_CONFIG (missing); OPENAI_BASE_URL can override https://api.openai.com/v1",
			"Anthropic: API key via ANTHROPIC_FROM_CONFIG (missing); ANTHROPIC_BASE_URL can override https://api.anthropic.com",
		]);
	});

	it("shows active local proxy base URL overrides without changing auth method text", async () => {
		const { providerSetupSummaryLines } = await import(
			"../../src/menu/models/auth-summary.tsx"
		);
		expect(
			providerSetupSummaryLines(
				[
					["openai", expectPresent(PROVIDERS.openai)],
					["anthropic", expectPresent(PROVIDERS.anthropic)],
					["gemini", expectPresent(PROVIDERS.gemini)],
				],
				{
					OPENAI_BASE_URL: "http://127.0.0.1:8080/v1",
					ANTHROPIC_BASE_URL: "http://127.0.0.1:8080",
					GEMINI_BASE_URL: "http://127.0.0.1:8080/v1beta",
				},
			),
		).toEqual([
			"OpenAI: ChatGPT OAuth via CODEX_ACCESS_TOKEN (missing); API key via OPENAI_API_KEY (missing); OPENAI_BASE_URL can override https://api.openai.com/v1; active base URL http://127.0.0.1:8080/v1",
			"Anthropic: API key via ANTHROPIC_API_KEY (missing); ANTHROPIC_BASE_URL can override https://api.anthropic.com; active base URL http://127.0.0.1:8080",
			"Google Gemini: API key via GEMINI_API_KEY (missing); GEMINI_BASE_URL can override https://generativelanguage.googleapis.com/v1beta; active base URL http://127.0.0.1:8080/v1beta",
		]);
	});

	it("does not invent API-key setup text for providers without supported auth methods", async () => {
		const { providerSetupSummaryLines } = await import(
			"../../src/menu/models/auth-summary.tsx"
		);
		const synthetic = expectPresent(PROVIDERS.synthetic);

		expect(
			providerSetupSummaryLines(
				[
					[
						"synthetic",
						{
							...synthetic,
							name: "No Auth",
							envVar: "NO_AUTH_API_KEY",
							authMethods: [],
						},
					],
				],
				{},
			),
		).toEqual([
			"No Auth: no supported authentication methods; SYNTHETIC_BASE_URL can override https://api.synthetic.new/v1",
		]);
	});

	it("does not resolve API-key override text for OAuth-only providers", async () => {
		const { providerSetupSummaryLines } = await import(
			"../../src/menu/models/auth-summary.tsx"
		);
		const openai = expectPresent(PROVIDERS.openai);

		expect(
			providerSetupSummaryLines(
				[
					[
						"openai",
						{
							...openai,
							authMethods: ["chatgpt-oauth"],
						},
					],
				],
				{ CODEX_ACCESS_TOKEN: "oauth" },
				{ defaultApiKeyOverrides: { openai: "OPENAI_FROM_CONFIG" } },
			),
		).toEqual([
			"OpenAI: ChatGPT OAuth via CODEX_ACCESS_TOKEN (detected); OPENAI_BASE_URL can override https://api.openai.com/v1",
		]);
	});

	it("shows config-aware setup details before provider selection", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { ModelSetup } = await import(
			"../../src/menu/models/detect-models.tsx"
		);

		const instance = render(
			React.createElement(ModelSetup, {
				config: {
					yourName: "Ada",
					models: [],
					defaultApiKeyOverrides: { openai: "OPENAI_FROM_CONFIG" },
				},
				env: {},
				onComplete: () => undefined,
				onCancel: () => undefined,
				onOverrideDefaultApiKey: () => Promise.resolve(),
			}),
		);
		const frame = (instance.lastFrame() ?? "").replace(/\s+/g, " ");

		expect(frame).toContain("Provider setup at a glance");
		expect(frame).toContain("OpenAI: ChatGPT OAuth via CODEX_ACCESS_TOKEN");
		expect(frame).toContain("API key via OPENAI_FROM_CONFIG (missing)");
		expect(frame).not.toContain("API key via OPENAI_API_KEY");
		expect(frame).toContain(
			"Anthropic: API key via ANTHROPIC_API_KEY (missing)",
		);
		expect(frame).toContain(
			"Google Gemini: API key via GEMINI_API_KEY (missing)",
		);
		expect(frame).toContain(
			"Synthetic: API key via SYNTHETIC_API_KEY (missing)",
		);
		expect(frame).toContain("OPENAI_BASE_URL");
	});

	it("normalizes rendered provider summary lines from config and env overrides", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { ProviderSetupSummary } = await import(
			"../../src/menu/models/auth-summary.tsx"
		);
		const instance = render(
			React.createElement(ProviderSetupSummary, {
				config: { defaultApiKeyOverrides: { openai: "OPENAI_FROM_CONFIG\r" } },
				env: { OPENAI_BASE_URL: "http://127.0.0.1:8080/v1\rnext" },
			}),
		);

		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("OPENAI_FROM_CONFIG");
		expect(frame).toContain("http://127.0.0.1:8080/v1\nnext");
		expect(frame).not.toContain("\r");
		instance.unmount();
	});

	it("uses latest cancel callback after model setup rerender", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { ModelSetup } = await import(
			"../../src/menu/models/detect-models.tsx"
		);
		const calls: string[] = [];
		const renderSetup = (onCancel: () => void) =>
			React.createElement(ModelSetup, {
				config: {
					yourName: "Ada",
					models: [],
				},
				env: {},
				onComplete: () => undefined,
				onCancel,
				onOverrideDefaultApiKey: () => Promise.resolve(),
			});

		const instance = render(renderSetup(() => calls.push("first:cancel")));
		instance.rerender(renderSetup(() => calls.push("second:cancel")));
		instance.stdin.write("\u001B");
		await waitFor(() => calls.length === 1);

		expect(calls).toEqual(["second:cancel"]);
		instance.unmount();
	});

	it("uses latest provider-list callbacks after rerender", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { FastProviderList } = await import(
			"../../src/menu/models/provider-screen.tsx"
		);
		const calls: string[] = [];
		const firstCallbacks = {
			onChooseProvider: () => calls.push("first:provider"),
			onChooseCustom: () => calls.push("first:custom"),
			onBack: () => calls.push("first:back"),
		};
		const secondCallbacks = {
			onChooseProvider: () => calls.push("second:provider"),
			onChooseCustom: () => calls.push("second:custom"),
			onBack: () => calls.push("second:back"),
		};

		const instance = render(
			React.createElement(FastProviderList, {
				...firstCallbacks,
				config: null,
				env: {},
			}),
		);
		instance.rerender(
			React.createElement(FastProviderList, {
				...secondCallbacks,
				config: null,
				env: {},
			}),
		);
		instance.stdin.write("c");
		await waitFor(() => calls.length === 1);
		instance.stdin.write("b");
		await waitFor(() => calls.length === 2);

		expect(calls).toEqual(["second:custom", "second:back"]);
		instance.unmount();
	});
});
