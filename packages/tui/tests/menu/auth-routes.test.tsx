import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Timed out waiting for condition");
}

function expectPresent<T>(value: T): NonNullable<T> {
	if (value === null || value === undefined) {
		throw new Error("Expected value to be present");
	}
	return value;
}

describe("auth route builders", () => {
	it("submits existing environment variables as API-key auth, not ChatGPT OAuth", async () => {
		const { envVar } = await import(
			"../../src/menu/models/auth-routes"
		);
		const { PROVIDERS } = await import(
			"../../src/runtime/models/catalog/main"
		);
		const completed: unknown[] = [];

		const route = envVar({
			authAsk: () => null,
			envVar: () => null,
			postAuth: (props: { auth?: unknown }) => {
				completed.push(props.auth);
				return null;
			},
		});
		const instance = render(
			React.createElement(route, {
				baseUrl: "https://api.openai.com/v1",
				provider: expectPresent(PROVIDERS.openai),
				config: null,
				renderExamples: false,
				done: () => undefined,
				cancel: () => undefined,
				env: { OPENAI_ENV_ROUTE_TEST: "route-test-key" },
			}),
		);

		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("Environment variable name:"),
		);
		await Bun.sleep(25);
		instance.stdin.write("OPENAI_ENV_ROUTE_TEST");
		await Bun.sleep(25);
		instance.stdin.write("\r");
		await waitFor(() => completed.length === 1);

		expect(completed).toEqual([
			{
				type: "env",
				name: "OPENAI_ENV_ROUTE_TEST",
				credential: "api-key",
			},
		]);
	});

	it("env-var route uses latest props and callbacks after rerender", async () => {
		const { EnvVarRoute } = await import(
			"../../src/menu/models/input-routes"
		);
		const completed: unknown[] = [];
		const backCalls: unknown[] = [];
		const renderRoute = (tag: string, env: Record<string, string>) =>
			React.createElement(EnvVarRoute, {
				baseUrl: `https://${tag}.example.test/v1`,
				provider: undefined,
				config: null,
				renderExamples: false,
				done: () => undefined,
				cancel: () => undefined,
				env,
				to: {
					authAsk: (props: unknown) => {
						backCalls.push({ tag, props });
					},
					postAuth: (props: { auth?: unknown; baseUrl: string }) => {
						completed.push({ tag, auth: props.auth, baseUrl: props.baseUrl });
					},
				},
			});
		const instance = render(renderRoute("old", {}));

		instance.rerender(renderRoute("new", { LATEST_ENV_KEY: "secret" }));
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("Environment variable name:"),
		);
		instance.stdin.write("LATEST_ENV_KEY");
		await Bun.sleep(25);
		instance.stdin.write("\r");
		await waitFor(() => completed.length === 1);

		expect(backCalls).toEqual([]);
		expect(completed).toEqual([
			{
				tag: "new",
				baseUrl: "https://new.example.test/v1",
				auth: {
					type: "env",
					name: "LATEST_ENV_KEY",
					credential: "api-key",
				},
			},
		]);
	});

	it("env-var route uses latest back callback after rerender", async () => {
		const { EnvVarRoute } = await import(
			"../../src/menu/models/input-routes"
		);
		const backCalls: unknown[] = [];
		const renderRoute = (tag: string) =>
			React.createElement(EnvVarRoute, {
				baseUrl: `https://${tag}.example.test/v1`,
				provider: undefined,
				config: null,
				renderExamples: false,
				done: () => undefined,
				cancel: () => undefined,
				env: {},
				to: {
					authAsk: (props: unknown) => {
						backCalls.push({ tag, props });
					},
					postAuth: () => undefined,
				},
			});
		const instance = render(renderRoute("old"));

		instance.rerender(renderRoute("new"));
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("Environment variable name:"),
		);
		instance.stdin.write("\x1B");
		await waitFor(() => backCalls.length === 1);

		expect(backCalls).toEqual([
			{
				tag: "new",
				props: expect.objectContaining({
					baseUrl: "https://new.example.test/v1",
				}),
			},
		]);
	});

	it("uses provider-specific env var examples in API-key setup", async () => {
		const { envVarExampleForBaseUrl } = await import(
			"../../src/menu/models/auth-routes"
		);
		const { PROVIDERS } = await import(
			"../../src/runtime/models/catalog/main"
		);

		expect(envVarExampleForBaseUrl("https://api.openai.com/v1")).toBe(
			"OPENAI_API_KEY",
		);
		expect(envVarExampleForBaseUrl("https://api.anthropic.com")).toBe(
			"ANTHROPIC_API_KEY",
		);
		expect(
			envVarExampleForBaseUrl(
				"https://generativelanguage.googleapis.com/v1beta",
			),
		).toBe("GEMINI_API_KEY");
		expect(envVarExampleForBaseUrl("https://api.synthetic.new/openai/v1")).toBe(
			"SYNTHETIC_API_KEY",
		);
		expect(envVarExampleForBaseUrl("https://models.example.test/v1")).toBe(
			"YOUR_API_KEY",
		);
		expect(
			envVarExampleForBaseUrl(
				"http://127.0.0.1:8080/v1",
				expectPresent(PROVIDERS.openai),
			),
		).toBe("OPENAI_API_KEY");
	});

	it("requires env auth variables to contain non-whitespace values", async () => {
		const { envVarHasNonEmptyValue, normalizeEnvVarName } = await import(
			"../../src/menu/models/auth-routes"
		);
		const { nonEmptyEnvValue } = await import(
			"../../src/menu/models/providers"
		);

		expect(normalizeEnvVarName(" MODEL_SETUP_ENV_AUTH_KEY ")).toBe(
			"MODEL_SETUP_ENV_AUTH_KEY",
		);
		expect(
			envVarHasNonEmptyValue("MODEL_SETUP_ENV_AUTH_KEY", {
				MODEL_SETUP_ENV_AUTH_KEY: "secret",
			}),
		).toBe(true);
		expect(
			envVarHasNonEmptyValue(" MODEL_SETUP_ENV_AUTH_KEY ", {
				MODEL_SETUP_ENV_AUTH_KEY: "secret",
			}),
		).toBe(true);
		expect(
			envVarHasNonEmptyValue("MODEL_SETUP_ENV_AUTH_KEY", {
				MODEL_SETUP_ENV_AUTH_KEY: " \n\t ",
			}),
		).toBe(false);
		expect(envVarHasNonEmptyValue("MODEL_SETUP_ENV_AUTH_KEY", {})).toBe(false);
		expect(envVarHasNonEmptyValue(" \n\t ", {})).toBe(false);
		expect(
			nonEmptyEnvValue("MODEL_SETUP_ENV_AUTH_KEY", {
				MODEL_SETUP_ENV_AUTH_KEY: " secret ",
			}),
		).toBe("secret");
	});

	it("validates command auth input without accepting shell operators", async () => {
		const { command } = await import(
			"../../src/menu/models/auth-routes"
		);
		const { errorContext } = await import(
			"../../src/menu/models/error-context"
		);
		const route = command({
			authAsk: () => null,
			command: () => null,
			postAuth: () => null,
		});
		function Harness() {
			const [errorMessage, setErrorMessage] = React.useState("");
			return React.createElement(
				errorContext.Provider,
				{ value: { errorMessage, setErrorMessage } },
				React.createElement(route, {
					baseUrl: "https://models.example.test/v1",
					provider: undefined,
					config: null,
					renderExamples: false,
					done: () => undefined,
					cancel: () => undefined,
					env: { CODEX_ACCESS_TOKEN: "oauth-token" },
				}),
			);
		}
		const instance = render(React.createElement(Harness));

		await waitFor(() => (instance.lastFrame() ?? "").includes("Command:"));
		await Bun.sleep(25);
		instance.stdin.write("printf key | cat");
		await Bun.sleep(25);
		instance.stdin.write("\r");
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("Shell operators like pipes"),
		);
	});

	it("submits command auth as parsed argv", async () => {
		const { command } = await import(
			"../../src/menu/models/auth-routes"
		);
		const completed: unknown[] = [];
		const route = command({
			authAsk: () => null,
			command: () => null,
			postAuth: (props: { auth?: unknown }) => {
				completed.push(props.auth);
				return null;
			},
		});
		const instance = render(
			React.createElement(route, {
				baseUrl: "https://models.example.test/v1",
				provider: undefined,
				config: null,
				renderExamples: false,
				done: () => undefined,
				cancel: () => undefined,
			}),
		);

		await waitFor(() => (instance.lastFrame() ?? "").includes("Command:"));
		await Bun.sleep(25);
		instance.stdin.write('op read "op://vault/provider/key"');
		await Bun.sleep(25);
		instance.stdin.write("\r");
		await waitFor(() => completed.length === 1);

		expect(completed).toEqual([
			{
				type: "command",
				command: ["op", "read", "op://vault/provider/key"],
			},
		]);
	});
	it("uses provider-specific secret path examples in command auth setup", async () => {
		const { secretPathExampleForBaseUrl } = await import(
			"../../src/menu/models/auth-routes"
		);
		const { PROVIDERS } = await import(
			"../../src/runtime/models/catalog/main"
		);

		expect(secretPathExampleForBaseUrl("https://api.openai.com/v1")).toBe(
			"openai",
		);
		expect(secretPathExampleForBaseUrl("https://api.anthropic.com")).toBe(
			"anthropic",
		);
		expect(
			secretPathExampleForBaseUrl(
				"https://generativelanguage.googleapis.com/v1beta",
			),
		).toBe("gemini");
		expect(
			secretPathExampleForBaseUrl("https://api.synthetic.new/openai/v1"),
		).toBe("synthetic");
		expect(secretPathExampleForBaseUrl("https://models.example.test/v1")).toBe(
			"provider",
		);
		expect(
			secretPathExampleForBaseUrl(
				"http://127.0.0.1:8080/v1",
				expectPresent(PROVIDERS.openai),
			),
		).toBe("openai");
	});

	it("completes OpenAI ChatGPT OAuth setup from a token environment variable", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { chatGptOAuth } = await import(
			"../../src/menu/models/auth-routes"
		);
		const { PROVIDERS } = await import(
			"../../src/runtime/models/catalog/main"
		);
		const completed: unknown[] = [];

		const route = chatGptOAuth({
			authAsk: () => null,
			chatGptOAuth: () => null,
			postAuth: (props: { auth?: unknown }) => {
				completed.push(props.auth);
				return null;
			},
		});
		const instance = render(
			React.createElement(route, {
				baseUrl: "https://api.openai.com/v1",
				provider: expectPresent(PROVIDERS.openai),
				config: null,
				renderExamples: false,
				done: () => undefined,
				cancel: () => undefined,
				env: { CODEX_ACCESS_TOKEN: "oauth-token" },
			}),
		);

		await waitFor(() =>
			(instance.lastFrame() ?? "").includes(
				"OAuth token environment variable:",
			),
		);
		await Bun.sleep(25);
		instance.stdin.write("\r");
		await waitFor(() => completed.length === 1);

		expect(completed).toEqual([
			{
				type: "env",
				name: "CODEX_ACCESS_TOKEN",
				credential: "chatgpt-oauth",
			},
		]);
	});
});
