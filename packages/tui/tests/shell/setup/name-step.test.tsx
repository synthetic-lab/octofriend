import { describe, expect, test } from "bun:test";
import { NameStep } from "../../../src/shell/setup/name-step.tsx";

function waitFor(predicate: () => boolean): Promise<void> {
	return new Promise((resolve, reject) => {
		let attempt = 0;
		const poll = () => {
			if (predicate()) {
				resolve();
				return;
			}
			attempt += 1;
			if (attempt >= 50) {
				reject(new Error("Timed out waiting for condition"));
				return;
			}
			setTimeout(poll, 1);
		};
		poll();
	});
}

function deferred<T>() {
	let resolve: (value: T) => void = () => undefined;
	let reject: (error: unknown) => void = () => undefined;
	const promise = new Promise<T>((nextResolve, nextReject) => {
		resolve = nextResolve;
		reject = nextReject;
	});
	return { promise, resolve, reject };
}

describe("first-time setup name step", () => {
	test("summarizes the config before saving", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { NameStep } = await import("../../../src/shell/setup/name-step.tsx");

		const instance = render(
			React.createElement(NameStep, {
				configPath: "/tmp/octofriend-test-config.json",
				models: [
					{
						nickname: "GPT",
						baseUrl: "https://api.openai.com/v1",
						model: "gpt-5.4-mini",
						context: 400000,
					},
				],
				autofixConfig: {
					diffApply: {
						baseUrl: "https://api.synthetic.new/v1",
						model: "hf:syntheticlab/diff-apply",
					},
					fixJson: {
						baseUrl: "https://api.synthetic.new/v1",
						model: "hf:syntheticlab/fix-json",
					},
				},
				defaultApiKeyOverrides: {
					anthropic: "ANTHROPIC_KEY",
					synthetic: "SYNTHETIC_API_KEY",
					openai: "OPENAI_KEY",
					custom: "CUSTOM_KEY",
				},
				onDone: () => undefined,
			}),
		);

		await waitFor(() =>
			(instance.lastFrame() ?? "").includes(
				"Review setup, then enter your name to save.",
			),
		);

		const frame = instance.lastFrame() ?? "";
		const normalizedFrame = frame.replace(/\s+/g, " ");
		expect(frame).toContain("Main models: 1 (GPT)");
		expect(frame).toContain("Autofix models: enabled");
		expect(normalizedFrame).toContain(
			"API-key overrides: Synthetic: SYNTHETIC_API_KEY, OpenAI: OPENAI_KEY, Anthropic: ANTHROPIC_KEY, custom: CUSTOM_KEY",
		);
	});

	test("normalizes CR line breaks in setup summary and save errors", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { NameStep } = await import("../../../src/shell/setup/name-step.tsx");

		const instance = render(
			React.createElement(NameStep, {
				configPath: "/tmp/octofriend-test-config.json",
				models: [
					{
						nickname: "GPT\r\nModel",
						baseUrl: "https://api.openai.com/v1",
						model: "gpt-test",
						context: 128000,
						auth: { type: "env", name: "OPENAI\rKEY" },
					},
				],
				defaultApiKeyOverrides: { custom: "CUSTOM\r\nKEY" },
				onDone: () => undefined,
				writeConfig: () => Promise.reject(new Error("disk\r\nfull")),
			}),
		);

		await waitFor(() => (instance.lastFrame() ?? "").includes("GPT"));
		instance.stdin.write("Ada");
		instance.stdin.write("\r");
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("Failed to save"),
		);

		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("GPT");
		expect(frame).toContain("Model");
		expect(frame).toContain("OPENAI");
		expect(frame).toContain("KEY");
		expect(frame).toContain("CUSTOM");
		expect(frame).toContain("disk");
		expect(frame).toContain("full");
		expect(frame).not.toContain("\r");
	});

	test("summarizes only own API-key override properties", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { NameStep } = await import("../../../src/shell/setup/name-step.tsx");
		const overrides = Object.create({
			openai: "INHERITED_OPENAI_KEY",
			custom: "INHERITED_CUSTOM_KEY",
		}) as Record<string, string>;
		overrides.synthetic = "SYNTHETIC_API_KEY";

		const instance = render(
			React.createElement(NameStep, {
				configPath: "/tmp/octofriend-test-config.json",
				models: [],
				defaultApiKeyOverrides: overrides,
				onDone: () => undefined,
			}),
		);

		await waitFor(() =>
			(instance.lastFrame() ?? "").includes(
				"Review setup, then enter your name to save.",
			),
		);

		const normalizedFrame = (instance.lastFrame() ?? "").replace(/\s+/g, " ");
		expect(normalizedFrame).toContain(
			"API-key overrides: Synthetic: SYNTHETIC_API_KEY",
		);
		expect(normalizedFrame).not.toContain("INHERITED_OPENAI_KEY");
		expect(normalizedFrame).not.toContain("INHERITED_CUSTOM_KEY");
	});
	test("trims and skips blank API-key overrides in setup summary", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { NameStep } = await import("../../../src/shell/setup/name-step.tsx");

		const instance = render(
			React.createElement(NameStep, {
				configPath: "/tmp/octofriend-test-config.json",
				models: [],
				defaultApiKeyOverrides: {
					openai: " OPENAI_API_KEY ",
					anthropic: "   ",
				},
				onDone: () => undefined,
			}),
		);

		await waitFor(() =>
			(instance.lastFrame() ?? "").includes(
				"Review setup, then enter your name to save.",
			),
		);

		const normalizedFrame = (instance.lastFrame() ?? "").replace(/\s+/g, " ");
		expect(normalizedFrame).toContain(
			"API-key overrides: OpenAI: OPENAI_API_KEY",
		);
		expect(normalizedFrame).not.toContain("Anthropic:");
		expect(normalizedFrame).not.toContain("OpenAI:  OPENAI_API_KEY");
		expect(normalizedFrame).not.toContain("OPENAI_API_KEY  ");
	});
	test("summarizes missing model auth as none when no models were configured", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { NameStep } = await import("../../../src/shell/setup/name-step.tsx");

		const instance = render(
			React.createElement(NameStep, {
				configPath: "/tmp/octofriend-test-config.json",
				models: [],
				defaultApiKeyOverrides: {},
				onDone: () => undefined,
			}),
		);

		await waitFor(() =>
			(instance.lastFrame() ?? "").includes(
				"Review setup, then enter your name to save.",
			),
		);

		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("Main models: 0");
		expect(frame).toContain("Model auth: none");
		expect(frame).not.toContain("Model auth: stored keys");
	});
	test("summarizes model-level auth without treating ChatGPT OAuth as an API-key override", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { NameStep } = await import("../../../src/shell/setup/name-step.tsx");

		const instance = render(
			React.createElement(NameStep, {
				configPath: "/tmp/octofriend-test-config.json",
				models: [
					{
						nickname: "OpenAI OAuth",
						baseUrl: "https://api.openai.com/v1",
						model: "gpt-5.4-mini",
						context: 400000,
						auth: {
							type: "env",
							name: " OPENAI_CODEX_ACCESS_TOKEN\n",
							credential: "chatgpt-oauth",
						},
					},
					{
						nickname: "Claude",
						baseUrl: "https://api.anthropic.com",
						model: "claude-haiku-4-5",
						context: 200000,
						auth: {
							type: "env",
							name: "ANTHROPIC_API_KEY",
							credential: "api-key",
						},
					},
					{
						nickname: "Empty Env",
						baseUrl: "https://example.test/v1",
						model: "example",
						context: 1000,
						auth: {
							type: "env",
							name: "  ",
							credential: "api-key",
						},
					},
				],
				defaultApiKeyOverrides: {},
				onDone: () => undefined,
			}),
		);

		await waitFor(() =>
			(instance.lastFrame() ?? "").includes(
				"Review setup, then enter your name to save.",
			),
		);

		const normalizedFrame = (instance.lastFrame() ?? "").replace(/\s+/g, " ");
		expect(normalizedFrame).toContain(
			"Model auth: OpenAI OAuth: OPENAI_CODEX_ACCESS_TOKEN (ChatGPT OAuth), Claude: ANTHROPIC_API_KEY (API key)",
		);
		expect(normalizedFrame).not.toContain("Empty Env:");
		expect(normalizedFrame).toContain("API-key overrides: none");
	});

	test("uses latest callbacks and config props after rerender", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { NameStep } = await import("../../../src/shell/setup/name-step.tsx");
		const writes: unknown[] = [];
		const doneCalls: string[] = [];
		const backCalls: string[] = [];
		const instance = render(
			React.createElement(NameStep, {
				configPath: "/tmp/old-config.json",
				models: [],
				defaultApiKeyOverrides: {},
				onDone: () => {
					doneCalls.push("old");
				},
				onBack: () => {
					backCalls.push("old");
				},
				writeConfig: (input) => {
					writes.push({ writer: "old", input });
					return Promise.resolve();
				},
			}),
		);

		instance.stdin.write(" Ada ");
		await waitFor(() => (instance.lastFrame() ?? "").includes("Ada"));
		instance.rerender(
			React.createElement(NameStep, {
				configPath: "/tmp/new-config.json",
				models: [
					{
						nickname: "Claude",
						baseUrl: "https://api.anthropic.com",
						model: "claude-haiku-4-5",
						context: 200000,
					},
				],
				defaultApiKeyOverrides: { anthropic: "ANTHROPIC_API_KEY" },
				onDone: () => {
					doneCalls.push("new");
				},
				onBack: () => {
					backCalls.push("new");
				},
				writeConfig: (input) => {
					writes.push({ writer: "new", input });
					return Promise.resolve();
				},
			}),
		);
		instance.stdin.write("\r");
		await waitFor(() => doneCalls.length === 1);

		expect(backCalls).toEqual([]);
		expect(doneCalls).toEqual(["new"]);
		expect(writes).toEqual([
			{
				writer: "new",
				input: {
					configPath: "/tmp/new-config.json",
					yourName: "Ada",
					models: [
						{
							nickname: "Claude",
							baseUrl: "https://api.anthropic.com",
							model: "claude-haiku-4-5",
							context: 200000,
						},
					],
					defaultApiKeyOverrides: { anthropic: "ANTHROPIC_API_KEY" },
					autofixConfig: undefined,
				},
			},
		]);
	});

	test("uses latest back callback after rerender", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { NameStep } = await import("../../../src/shell/setup/name-step.tsx");
		const backCalls: string[] = [];
		const instance = render(
			React.createElement(NameStep, {
				configPath: "/tmp/old-config.json",
				models: [],
				defaultApiKeyOverrides: {},
				onDone: () => undefined,
				onBack: () => {
					backCalls.push("old");
				},
			}),
		);

		instance.rerender(
			React.createElement(NameStep, {
				configPath: "/tmp/old-config.json",
				models: [],
				defaultApiKeyOverrides: {},
				onDone: () => undefined,
				onBack: () => {
					backCalls.push("new");
				},
			}),
		);
		instance.stdin.write("\x1B");
		await waitFor(() => backCalls.length === 1);

		expect(backCalls).toEqual(["new"]);
	});
	test("keeps the name step visible and ignores duplicate submits while saving", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const save = deferred<void>();
		const writes: unknown[] = [];
		let doneCount = 0;

		const instance = render(
			React.createElement(NameStep, {
				configPath: "/tmp/octofriend-test-config.json",
				models: [],
				defaultApiKeyOverrides: {},
				onDone: () => {
					doneCount += 1;
				},
				writeConfig: (input) => {
					writes.push(input);
					return save.promise;
				},
			}),
		);

		await Bun.sleep(1);
		instance.stdin.write("Ada");
		await waitFor(() => (instance.lastFrame() ?? "").includes("Ada"));
		instance.stdin.write("\r");
		await waitFor(() => writes.length === 1);
		instance.stdin.write("\r");
		await Bun.sleep(1);

		expect(writes).toHaveLength(1);
		expect(instance.lastFrame() ?? "").toContain("Saving config...");
		expect(doneCount).toBe(0);

		save.resolve();
		await Bun.sleep(1);

		expect(doneCount).toBe(1);
		expect(instance.lastFrame() ?? "").toContain("Saving config...");
	});

	test("lets users go back from the name step before saving", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		let backCount = 0;

		const instance = render(
			React.createElement(NameStep, {
				configPath: "/tmp/octofriend-test-config.json",
				models: [],
				defaultApiKeyOverrides: {},
				onBack: () => {
					backCount += 1;
				},
				onDone: () => undefined,
			}),
		);

		await Bun.sleep(1);
		instance.stdin.write("\x1B");
		await waitFor(() => backCount === 1);

		expect(backCount).toBe(1);
	});

	test("keeps the name step from going back while saving", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const save = deferred<void>();
		let backCount = 0;

		const instance = render(
			React.createElement(NameStep, {
				configPath: "/tmp/octofriend-test-config.json",
				models: [],
				defaultApiKeyOverrides: {},
				onBack: () => {
					backCount += 1;
				},
				onDone: () => undefined,
				writeConfig: () => save.promise,
			}),
		);

		await Bun.sleep(1);
		instance.stdin.write("Ada");
		await waitFor(() => (instance.lastFrame() ?? "").includes("Ada"));
		instance.stdin.write("\r");
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("Saving config..."),
		);
		instance.stdin.write("\x1B");
		await Bun.sleep(1);

		expect(backCount).toBe(0);
		save.resolve();
		await Bun.sleep(1);
	});

	test("surfaces config write failures in the name step", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		let doneCount = 0;

		const instance = render(
			React.createElement(NameStep, {
				configPath: "/tmp/octofriend-test-config.json",
				models: [],
				defaultApiKeyOverrides: {},
				onDone: () => {
					doneCount += 1;
				},
				writeConfig: () => Promise.reject(new Error("disk full")),
			}),
		);

		await Bun.sleep(1);
		instance.stdin.write("Ada");
		await waitFor(() => (instance.lastFrame() ?? "").includes("Ada"));
		instance.stdin.write("\r");
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("Failed to save config: disk full"),
		);

		expect(instance.lastFrame() ?? "").toContain(
			"Failed to save config: disk full",
		);
		expect(doneCount).toBe(0);
	});

	test("surfaces synchronous config write failures in the name step", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		let doneCount = 0;

		const instance = render(
			React.createElement(NameStep, {
				configPath: "/tmp/octofriend-test-config.json",
				models: [],
				defaultApiKeyOverrides: {},
				onDone: () => {
					doneCount += 1;
				},
				writeConfig: () => {
					throw new Error("disk vanished");
				},
			}),
		);

		await Bun.sleep(1);
		instance.stdin.write("Ada");
		await waitFor(() => (instance.lastFrame() ?? "").includes("Ada"));
		instance.stdin.write("\r");
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes(
				"Failed to save config: disk vanished",
			),
		);

		expect(instance.lastFrame() ?? "").toContain(
			"Failed to save config: disk vanished",
		);
		expect(doneCount).toBe(0);
	});
});
