import { describe, expect, test } from "bun:test";
import {
	AutofixSetup,
	autofixSetupFlow,
} from "../../../src/shell/setup/autofix.tsx";
import { AutofixSetupChooseRoute } from "../../../src/shell/setup/autofix-choice.tsx";
import {
	FirstTimeSetup,
	firstTimeSetupFlow,
} from "../../../src/shell/setup/main.tsx";

function deferred<T>() {
	let resolve: (value: T) => void = () => undefined;
	let reject: (error: unknown) => void = () => undefined;
	const promise = new Promise<T>((nextResolve, nextReject) => {
		resolve = nextResolve;
		reject = nextReject;
	});
	return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Timed out waiting for condition");
}

describe("terminal first-time setup", () => {
	test("exports router-backed first-time setup components", () => {
		expect(FirstTimeSetup).toBeFunction();
		expect(firstTimeSetupFlow.route).toBeFunction();
		expect(AutofixSetup).toBeFunction();
		expect(autofixSetupFlow.route).toBeFunction();
	});

	test("makes the main coding model step explicit after skipping autofix", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");

		const instance = render(
			React.createElement(FirstTimeSetup, {
				configPath: "/tmp/octofriend-test-config.json",
				modelConnectionTest: () =>
					Promise.resolve({ valid: true, metadata: {} }),
			}),
		);

		instance.stdin.write("\r");
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("Optional: Enable autofix models"),
		);
		instance.stdin.write("s");
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("choose the coding model provider"),
		);

		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("skip autofix for now");
		expect(frame).toContain("OpenAI · ChatGPT OAuth or OPENAI_API_KEY");
		expect(frame).toContain("Provider setup at a glance");
	});

	test("can reach the first-time setup review after importing an API-key provider model", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const instance = render(
			React.createElement(FirstTimeSetup, {
				configPath: "/tmp/octofriend-test-config.json",
				modelConnectionTest: () =>
					Promise.resolve({ valid: true, metadata: {} }),
				env: { OPENAI_API_KEY: "sk-test" },
			}),
		);

		instance.stdin.write("\r");
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("Optional: Enable autofix models"),
		);
		instance.stdin.write("s");
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("choose the coding model provider"),
		);
		instance.stdin.write("o");
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("OpenAI models can be imported!"),
		);
		instance.stdin.write("\r");
		await waitFor(() => (instance.lastFrame() ?? "").includes("⦿"));
		const { PROVIDERS } = await import(
			"../../../src/runtime/models/catalog/main"
		);
		const openaiModels = PROVIDERS.openai?.models ?? [];
		const recommendedOpenAiModel = openaiModels[0];
		if (!recommendedOpenAiModel) throw new Error("Missing OpenAI model");
		instance.stdin.write(String(openaiModels.length + 1));
		await waitFor(() => (instance.lastFrame() ?? "").includes("Your name:"));

		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain(
			`Main models: 1 (${recommendedOpenAiModel.nickname} (OpenAI))`,
		);
		expect(frame).toContain("Autofix models: not enabled");
		expect(frame).toContain("Model auth: stored keys");
	});

	test("keeps setup route stable when runtime props change", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const firstTester = () => Promise.resolve({ valid: true, metadata: {} });
		const secondTester = () => Promise.resolve({ valid: true, metadata: {} });

		const instance = render(
			React.createElement(FirstTimeSetup, {
				configPath: "/tmp/octofriend-test-config.json",
				modelConnectionTest: firstTester,
			}),
		);

		instance.stdin.write("\r");
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("Optional: Enable autofix models"),
		);
		instance.stdin.write("s");
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("choose the coding model provider"),
		);

		instance.rerender(
			React.createElement(FirstTimeSetup, {
				configPath: "/tmp/octofriend-test-config.json",
				modelConnectionTest: secondTester,
			}),
		);

		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("choose the coding model provider");
		expect(frame).not.toContain("Welcome to octofriend");
	});

	test("explains Synthetic autofix authentication choices", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { ModelConnectionTestContext } = await import(
			"../../../src/menu/models/connection.ts"
		);

		const instance = render(
			React.createElement(
				ModelConnectionTestContext.Provider,
				{ value: () => Promise.resolve({ valid: true, metadata: {} }) },
				React.createElement(AutofixSetup, {
					onComplete: () => undefined,
					onSkip: () => undefined,
					onOverrideDefaultApiKey: () => Promise.resolve(),
				}),
			),
		);

		const frame = (instance.lastFrame() ?? "").replace(/\s+/g, " ");
		expect(frame).toContain("SYNTHETIC_API_KEY");
		expect(frame).toContain("enter a Synthetic API key");
		expect(frame).toContain("use another environment variable");
		expect(frame).toContain("use a secret command");
	});

	test("uses configured Synthetic API-key overrides in autofix setup", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { ModelConnectionTestContext } = await import(
			"../../../src/menu/models/connection.ts"
		);
		const calls: unknown[] = [];
		const completed: unknown[] = [];
		const instance = render(
			React.createElement(
				ModelConnectionTestContext.Provider,
				{
					value: (params) => {
						calls.push(params);
						return Promise.resolve({ valid: true, metadata: {} });
					},
				},
				React.createElement(AutofixSetup, {
					config: {
						yourName: "Ada",
						models: [],
						defaultApiKeyOverrides: { synthetic: "SYNTHETIC_ALT_KEY" },
					},
					onComplete: (config) => completed.push(config),
					onSkip: () => undefined,
					onOverrideDefaultApiKey: () => Promise.resolve(),
					env: { SYNTHETIC_ALT_KEY: "alt-key" },
				}),
			),
		);

		const initialFrame = instance.lastFrame() ?? "";
		expect(initialFrame).toContain("SYNTHETIC_ALT_KEY");
		expect(initialFrame).not.toContain("If SYNTHETIC_API_KEY is already set");

		instance.stdin.write("e");
		await waitFor(() => completed.length === 1);

		expect(calls).toEqual([
			{
				type: "standard",
				baseUrl: "https://api.synthetic.new/v1",
				apiKey: "alt-key",
				model: "hf:syntheticlab/diff-apply",
			},
			{
				type: "standard",
				baseUrl: "https://api.synthetic.new/v1",
				apiKey: "alt-key",
				model: "hf:syntheticlab/fix-json",
			},
		]);
		expect(completed).toEqual([
			{
				diffApply: {
					baseUrl: "https://api.synthetic.new/v1",
					auth: {
						type: "env",
						name: "SYNTHETIC_ALT_KEY",
						credential: "api-key",
					},
					model: "hf:syntheticlab/diff-apply",
				},
				fixJson: {
					baseUrl: "https://api.synthetic.new/v1",
					auth: {
						type: "env",
						name: "SYNTHETIC_ALT_KEY",
						credential: "api-key",
					},
					model: "hf:syntheticlab/fix-json",
				},
			},
		]);
	});

	test("uses latest autofix choice callbacks and config after rerender", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const calls: unknown[] = [];
		const completed: string[] = [];
		const skipped: string[] = [];
		const to = {
			choose: () => undefined,
			syntheticSetup: () => undefined,
			diffApplyCustom: () => undefined,
			fixJsonCustom: () => undefined,
		};
		const renderChoice = (tag: string, apiKeyName: string) =>
			React.createElement(AutofixSetupChooseRoute, {
				config: {
					yourName: "Ada",
					models: [],
					defaultApiKeyOverrides: { synthetic: apiKeyName },
				},
				env: { [apiKeyName]: `${tag}-key` },
				modelConnectionTest: (params) => {
					calls.push({ tag, params });
					return Promise.resolve({ valid: true, metadata: {} });
				},
				onComplete: () => completed.push(tag),
				onSkip: () => skipped.push(tag),
				to,
			});
		const instance = render(renderChoice("old", "SYNTHETIC_OLD_KEY"));

		instance.rerender(renderChoice("new", "SYNTHETIC_NEW_KEY"));
		instance.stdin.write("e");
		await waitFor(() => completed.length === 1);

		expect(completed).toEqual(["new"]);
		expect(skipped).toEqual([]);
		expect(calls).toEqual([
			{
				tag: "new",
				params: {
					type: "standard",
					baseUrl: "https://api.synthetic.new/v1",
					apiKey: "new-key",
					model: "hf:syntheticlab/diff-apply",
				},
			},
			{
				tag: "new",
				params: {
					type: "standard",
					baseUrl: "https://api.synthetic.new/v1",
					apiKey: "new-key",
					model: "hf:syntheticlab/fix-json",
				},
			},
		]);
	});

	test("uses latest autofix skip callback after rerender", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const skipped: string[] = [];
		const to = {
			choose: () => undefined,
			syntheticSetup: () => undefined,
			diffApplyCustom: () => undefined,
			fixJsonCustom: () => undefined,
		};
		const renderChoice = (tag: string) =>
			React.createElement(AutofixSetupChooseRoute, {
				config: null,
				modelConnectionTest: () =>
					Promise.resolve({ valid: true, metadata: {} }),
				onComplete: () => undefined,
				onSkip: () => skipped.push(tag),
				to,
			});
		const instance = render(renderChoice("old"));

		instance.rerender(renderChoice("new"));
		instance.stdin.write("s");
		await waitFor(() => skipped.length === 1);

		expect(skipped).toEqual(["new"]);
	});

	test("keeps autofix auth route stable when setup callbacks change", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { ModelConnectionTestContext } = await import(
			"../../../src/menu/models/connection.ts"
		);
		const noExistingKey = async () => false;
		const env = {};
		const renderSetup = (callbacks: {
			complete: () => void;
			skip: () => void;
			override: () => Promise<void>;
		}) =>
			React.createElement(
				ModelConnectionTestContext.Provider,
				{ value: () => Promise.resolve({ valid: true, metadata: {} }) },
				React.createElement(AutofixSetup, {
					onComplete: callbacks.complete,
					onSkip: callbacks.skip,
					onOverrideDefaultApiKey: callbacks.override,
					env,
					readKeyForModel: async () => null,
					hasExistingKey: noExistingKey,
				}),
			);
		const instance = render(
			renderSetup({
				complete: () => undefined,
				skip: () => undefined,
				override: () => Promise.resolve(),
			}),
		);

		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("Optional: Enable autofix models"),
		);
		instance.stdin.write("e");
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("How do you want to authenticate?"),
		);

		instance.rerender(
			renderSetup({
				complete: () => undefined,
				skip: () => undefined,
				override: () => Promise.resolve(),
			}),
		);

		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("How do you want to authenticate?");
		expect(frame).not.toContain("Optional: Enable autofix models");
	});

	test("shows progress and ignores duplicate Synthetic autofix selection while checking", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { ModelConnectionTestContext } = await import(
			"../../../src/menu/models/connection.ts"
		);
		const connection = deferred<{
			valid: true;
			metadata: Record<string, never>;
		}>();
		const calls: unknown[] = [];
		const instance = render(
			React.createElement(
				ModelConnectionTestContext.Provider,
				{
					value: (params) => {
						calls.push(params);
						return connection.promise;
					},
				},
				React.createElement(AutofixSetup, {
					onComplete: () => undefined,
					onSkip: () => undefined,
					onOverrideDefaultApiKey: () => Promise.resolve(),
					env: { SYNTHETIC_API_KEY: "synthetic-test-key" },
				}),
			),
		);

		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("Optional: Enable autofix models"),
		);
		instance.stdin.write("e");
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes(
				"Checking Synthetic autofix models...",
			),
		);
		instance.stdin.write("e");
		await Bun.sleep(1);

		expect(calls).toHaveLength(1);
	});
});
