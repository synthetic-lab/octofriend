import { describe, expect, it } from "bun:test";
import type { Config } from "../../internal/configuration/schemas.ts";

function expectPresent<T>(value: T): NonNullable<T> {
	if (value === null || value === undefined) {
		throw new Error("Expected value to be present");
	}
	return value;
}

function deferred<T>() {
	let resolve: (value: T) => void = () => undefined;
	const promise = new Promise<T>((nextResolve) => {
		resolve = nextResolve;
	});
	return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Timed out waiting for condition");
}

describe("terminal model setup helpers", () => {
	it("uses a known provider name for matching base URLs", async () => {
		const { getProviderDisplayName } = await import(
			"../../menu/model_setup/provider-helpers.ts"
		);

		expect(getProviderDisplayName("https://api.openai.com/v1")).toBe("OpenAI");
		expect(getProviderDisplayName("https://api.synthetic.new/openai/v1")).toBe(
			"Synthetic",
		);
	});

	it("falls back to the base URL for unknown providers", async () => {
		const { getProviderDisplayName } = await import(
			"../../menu/model_setup/provider-helpers.ts"
		);

		expect(getProviderDisplayName("https://models.example.test/v1")).toBe(
			"https://models.example.test/v1",
		);
	});

	it("derives default nicknames from model names without char-concat loops", async () => {
		const { defaultNicknameFromModelName } = await import(
			"../../menu/model_setup/add-model-route-builders.tsx"
		);

		expect(defaultNicknameFromModelName(undefined)).toBe("");
		expect(defaultNicknameFromModelName("openai/gpt-4.1-mini")).toBe(
			"gpt 4.1 mini",
		);
		expect(defaultNicknameFromModelName("gpt-5")).toBe("gpt 5");
		expect(defaultNicknameFromModelName("provider/")).toBe("");
		expect(defaultNicknameFromModelName("provider/claude")).toBe("claude");
	});

	it("renders custom base URL auth choices without requiring every catalog provider", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { AuthAsk } = await import(
			"../../menu/model_setup/auth-route-components.tsx"
		);

		const { lastFrame } = render(
			React.createElement(AuthAsk, {
				baseUrl: "http://127.0.0.1:8080/v1",
				renderExamples: false,
				config: null,
				done: () => undefined,
				cancel: () => undefined,
				back: () => undefined,
				onSelect: () => undefined,
			}),
		);

		const frame = lastFrame() ?? "";
		expect(frame).toContain("How do you want to authenticate?");
		expect(frame).toContain("This custom endpoint can use an API key");
		expect(frame).toContain("Use an existing environment variable");
	});

	it("derives provider auth choices without per-render shortcut rebuilding", async () => {
		const { authChoicesForProvider } = await import(
			"../../menu/model_setup/provider-auth.ts"
		);
		const { PROVIDERS } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);

		expect(authChoicesForProvider(expectPresent(PROVIDERS.openai))).toEqual({
			supportsApiKey: true,
			supportsChatGptOAuth: true,
		});
		expect(authChoicesForProvider(expectPresent(PROVIDERS.anthropic))).toEqual({
			supportsApiKey: true,
			supportsChatGptOAuth: false,
		});
		expect(authChoicesForProvider(expectPresent(PROVIDERS.gemini))).toEqual({
			supportsApiKey: true,
			supportsChatGptOAuth: false,
		});
		expect(authChoicesForProvider(expectPresent(PROVIDERS.synthetic))).toEqual({
			supportsApiKey: true,
			supportsChatGptOAuth: false,
		});
		expect(authChoicesForProvider(null)).toEqual({
			supportsApiKey: false,
			supportsChatGptOAuth: false,
		});
	});

	it("surfaces provider-specific OpenAI OAuth metadata without hiding API-key setup", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { AuthAsk } = await import(
			"../../menu/model_setup/auth-route-components.tsx"
		);

		const { lastFrame } = render(
			React.createElement(AuthAsk, {
				baseUrl: "https://api.openai.com/v1/",
				renderExamples: false,
				config: null,
				done: () => undefined,
				cancel: () => undefined,
				back: () => undefined,
				onSelect: () => undefined,
			}),
		);

		const frame = lastFrame() ?? "";
		expect(frame).toContain("OPENAI_API_KEY");
		expect(frame).toContain("CODEX_ACCESS_TOKEN");
		expect(frame).toContain("OpenAI can use ChatGPT OAuth or API key");
		expect(frame.replace(/\s+/g, " ")).toContain(
			"Neither CODEX_ACCESS_TOKEN or legacy OPENAI_CODEX_ACCESS_TOKEN nor the default API-key environment variable OPENAI_API_KEY",
		);
		expect(frame).toContain("ChatGPT OAuth");
		expect(frame).toContain("Use ChatGPT OAuth access token");
		expect(frame).toContain("Enter OpenAI API key");
		expect(frame).toContain(
			"Use OPENAI_API_KEY or another environment variable",
		);
	});

	it("does not advertise OAuth for Anthropic API-key-only setup", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { AuthAsk } = await import(
			"../../menu/model_setup/auth-route-components.tsx"
		);

		const { lastFrame } = render(
			React.createElement(AuthAsk, {
				baseUrl: "https://api.anthropic.com",
				renderExamples: false,
				config: null,
				done: () => undefined,
				cancel: () => undefined,
				back: () => undefined,
				onSelect: () => undefined,
			}),
		);

		const frame = lastFrame() ?? "";
		expect(frame).toContain("ANTHROPIC_API_KEY");
		expect(frame).toContain(
			"It looks like you don't have the default ANTHROPIC_API_KEY environment variable",
		);
		expect(frame).not.toContain("can use ChatGPT OAuth or an API key");
		expect(frame).not.toContain("ChatGPT OAuth");
		expect(frame).not.toContain("Use ChatGPT OAuth access token");
		expect(frame).toContain("Enter Anthropic API key");
	});

	it("does not advertise OAuth for Synthetic API-key-only setup", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { AuthAsk } = await import(
			"../../menu/model_setup/auth-route-components.tsx"
		);

		const { lastFrame } = render(
			React.createElement(AuthAsk, {
				baseUrl: "https://api.synthetic.new/openai/v1",
				renderExamples: false,
				config: null,
				done: () => undefined,
				cancel: () => undefined,
				back: () => undefined,
				onSelect: () => undefined,
			}),
		);

		const frame = lastFrame() ?? "";
		expect(frame).toContain("SYNTHETIC_API_KEY");
		expect(frame).toContain(
			"It looks like you don't have the default SYNTHETIC_API_KEY environment variable",
		);
		expect(frame).not.toContain("ChatGPT OAuth");
		expect(frame).not.toContain("Use ChatGPT OAuth access token");
		expect(frame).toContain("Enter Synthetic API key");
	});

	it("requires hf-prefixed model names for Synthetic base URLs and overrides", async () => {
		const { requiresSyntheticModelPrefix } = await import(
			"../../menu/model_setup/add-model-route-components.tsx"
		);
		const { PROVIDERS } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);

		expect(
			requiresSyntheticModelPrefix({
				baseUrl: "https://api.synthetic.new/v1",
			}),
		).toBe(true);
		expect(
			requiresSyntheticModelPrefix({
				baseUrl: "https://api.synthetic.new/openai/v1",
			}),
		).toBe(true);
		expect(
			requiresSyntheticModelPrefix({
				baseUrl: "http://127.0.0.1:8080/v1",
				provider: expectPresent(PROVIDERS.synthetic),
			}),
		).toBe(true);
		expect(
			requiresSyntheticModelPrefix({
				baseUrl: "https://api.openai.com/v1",
			}),
		).toBe(false);
	});

	it("does not retest model connections for equivalent config props", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { errorContext } = await import(
			"../../menu/model_setup/add-model-error-context.tsx"
		);
		const { ModelConnectionTestContext } = await import(
			"../../menu/model_setup/add-model-connection.ts"
		);
		const { TestConnection } = await import(
			"../../menu/model_setup/add-model-route-components.tsx"
		);
		let connectionCalls = 0;
		const tester = () => {
			connectionCalls += 1;
			return Promise.resolve({
				valid: true as const,
				metadata: { contextLength: 128_000 },
			});
		};
		const command = [process.execPath, "--eval", "console.log('test-api-key')"];
		const props = {
			renderExamples: false,
			done: () => undefined,
			cancel: () => undefined,
			baseUrl: "https://api.openai.com/v1",
			auth: { type: "command" as const, command },
			model: "gpt-4o",
			back: () => undefined,
			errorNav: () => undefined,
			onSubmit: () => undefined,
		};
		const tree = (config: Config) =>
			React.createElement(
				errorContext.Provider,
				{ value: { errorMessage: "", setErrorMessage: () => undefined } },
				React.createElement(
					ModelConnectionTestContext.Provider,
					{ value: tester },
					React.createElement(TestConnection, { ...props, config }),
				),
			);
		const rendered = render(
			tree({
				yourName: "Octo",
				models: [],
				defaultApiKeyOverrides: { openai: "OPENAI_API_KEY" },
			}),
		);

		await waitFor(() => connectionCalls === 1);
		rendered.rerender(
			tree({
				yourName: "Octo",
				models: [],
				defaultApiKeyOverrides: { openai: "OPENAI_API_KEY" },
			}),
		);
		await Bun.sleep(20);

		expect(connectionCalls).toBe(1);
	});

	it("returns API key URLs for known providers", async () => {
		const { getProviderApiKeyUrl } = await import(
			"../../menu/model_setup/provider-helpers.ts"
		);

		expect(getProviderApiKeyUrl("https://api.synthetic.new/v1")).toBe(
			"https://dev.synthetic.new/",
		);
		expect(getProviderApiKeyUrl("https://api.synthetic.new/openai/v1")).toBe(
			"https://dev.synthetic.new/",
		);
		expect(getProviderApiKeyUrl("https://api.openai.com/v1")).toBe(
			"https://platform.openai.com/api-keys",
		);
		expect(getProviderApiKeyUrl("https://api.anthropic.com")).toBe(
			"https://console.anthropic.com/settings/keys",
		);
		expect(
			getProviderApiKeyUrl("https://generativelanguage.googleapis.com/v1beta"),
		).toBe("https://aistudio.google.com/apikey");
		expect(getProviderApiKeyUrl("https://api.x.ai/v1")).toBe(
			"https://console.x.ai/",
		);
		expect(getProviderApiKeyUrl("https://models.example.test/v1")).toBeNull();
	});

	it("formats API key URLs as OSC 8 terminal hyperlinks", async () => {
		const { terminalHyperlink } = await import(
			"../../menu/model_setup/provider-helpers.ts"
		);

		expect(terminalHyperlink("https://platform.openai.com/api-keys")).toBe(
			"\u001B]8;;https://platform.openai.com/api-keys\u0007https://platform.openai.com/api-keys\u001B]8;;\u0007",
		);
		expect(
			terminalHyperlink("https://platform.openai.com/api-keys", "OpenAI keys"),
		).toBe(
			"\u001B]8;;https://platform.openai.com/api-keys\u0007OpenAI keys\u001B]8;;\u0007",
		);
	});

	it("rejects empty API keys with the legacy validation message", async () => {
		const { validateApiKeyValue } = await import(
			"../../menu/model_setup/set-api-key.tsx"
		);

		expect(validateApiKeyValue("")).toEqual({
			valid: false,
			error: "API key can't be empty",
		});
		expect(validateApiKeyValue(" \n\t ")).toEqual({
			valid: false,
			error: "API key can't be empty",
		});
		expect(validateApiKeyValue("sk-test")).toEqual({ valid: true });
	});
});

describe("terminal model setup routing", () => {
	it("returns typed route builders unchanged", async () => {
		const { router } = await import("../../menu/model_setup/setup-router.tsx");
		type Routes = {
			first: { value: string };
			second: { count: number };
		};
		const routes = router<Routes>();
		const first = routes.build("first", () => () => null);
		const second = routes
			.withRoutes("second")
			.build("second", () => () => null);

		expect(typeof first).toBe("function");
		expect(typeof second).toBe("function");
	});

	it("ignores duplicate async step submissions while the first submit is pending", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { Step } = await import("../../menu/model_setup/add-model-step.tsx");
		const { errorContext } = await import(
			"../../menu/model_setup/add-model-error-context.tsx"
		);
		const submit = deferred<void>();
		const submitted: string[] = [];

		const instance = render(
			React.createElement(
				errorContext.Provider,
				{ value: { errorMessage: "", setErrorMessage: () => undefined } },
				React.createElement(
					Step<string>,
					{
						title: "Async setup step",
						prompt: "Value:",
						parse: (value) => value,
						validate: () => ({ valid: true as const }),
						children: null,
						onSubmit: (value) => {
							submitted.push(value);
							return submit.promise;
						},
					},
					null,
				),
			),
		);

		await Bun.sleep(1);
		instance.stdin.write("  hello  ");
		await waitFor(() => (instance.lastFrame() ?? "").includes("hello"));
		instance.stdin.write("\r");
		await waitFor(() => submitted.length === 1);
		instance.stdin.write("\r");
		await Bun.sleep(1);

		expect(submitted).toEqual(["hello"]);

		submit.resolve();
		await waitFor(() => !(instance.lastFrame() ?? "").includes("Working..."));
		instance.stdin.write("\r");
		await waitFor(() => submitted.length === 2);

		expect(submitted).toEqual(["hello", "hello"]);
	});

	it("does not rerender the initial route when registering route listeners", async () => {
		const React = await import("react");
		const { Text } = await import("ink");
		const { render } = await import("ink-testing-library");
		const { router } = await import("../../menu/model_setup/setup-router.tsx");
		type Routes = {
			first: { value: string };
			second: { count: number };
		};
		let renderCount = 0;
		const routes = router<Routes>().route({
			first: () => (props) => {
				renderCount += 1;
				return React.createElement(Text, null, props.value);
			},
			second: () => (props) => React.createElement(Text, null, props.count),
		});

		render(
			React.createElement(routes.Root, {
				route: "first",
				props: { value: "ready" },
			}),
		);
		await Bun.sleep(1);

		expect(renderCount).toBe(1);
	});
});
