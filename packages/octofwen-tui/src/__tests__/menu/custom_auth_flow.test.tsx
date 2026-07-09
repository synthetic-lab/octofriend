import { describe, expect, it } from "bun:test";

import { deferred, expectPresent, waitFor } from "./test-support.ts";

describe("terminal custom auth flow", () => {
	it("renders an auth-checking screen instead of a blank frame", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { CustomAuthFlow } = await import(
			"../../menu/model_setup/custom-auth-flow.tsx"
		);

		const { lastFrame } = render(
			React.createElement(CustomAuthFlow, {
				baseUrl: "https://auth-checking.example.test/v1",
				config: null,
				onCancel: () => undefined,
				onComplete: () => undefined,
			}),
		);

		expect(lastFrame()).toContain("Checking existing authentication...");
	});

	it("routes Escape from existing-auth checking to cancel", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { CustomAuthFlow } = await import(
			"../../menu/model_setup/custom-auth-flow.tsx"
		);
		const existingAuth = deferred<boolean>();
		const cancels: string[] = [];
		const completions: string[] = [];
		const instance = render(
			React.createElement(CustomAuthFlow, {
				baseUrl: "https://slow-auth.example.test/v1",
				config: null,
				onCancel: () => cancels.push("cancel"),
				onComplete: () => completions.push("complete"),
				hasExistingKey: () => existingAuth.promise,
			}),
		);

		expect(instance.lastFrame()).toContain("Checking existing authentication");
		instance.stdin.write("\u001B");
		await waitFor(() => cancels.length === 1);
		existingAuth.resolve(true);
		await Bun.sleep(25);

		expect(cancels).toEqual(["cancel"]);
		expect(completions).toEqual([]);
		instance.unmount();
	});

	it("falls back to auth choices when existing-auth checks fail", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { CustomAuthFlow } = await import(
			"../../menu/model_setup/custom-auth-flow.tsx"
		);

		const instance = render(
			React.createElement(CustomAuthFlow, {
				baseUrl: "https://api.openai.com/v1",
				config: null,
				onCancel: () => undefined,
				onComplete: () => undefined,
				hasExistingKey: () => Promise.reject(new Error("agentd unavailable")),
			}),
		);

		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("agentd unavailable"),
		);
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("Failed to check existing authentication");
		expect(frame).toContain("Enter OpenAI API key");
	});

	it("falls back to auth choices when existing-auth checks throw synchronously", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { CustomAuthFlow } = await import(
			"../../menu/model_setup/custom-auth-flow.tsx"
		);

		const instance = render(
			React.createElement(CustomAuthFlow, {
				baseUrl: "https://api.openai.com/v1",
				config: null,
				onCancel: () => undefined,
				onComplete: () => undefined,
				hasExistingKey: () => {
					throw new Error("sync auth bridge unavailable");
				},
			}),
		);

		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("sync auth bridge unavailable"),
		);
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("Failed to check existing authentication");
		expect(frame).toContain("Enter OpenAI API key");
	});

	it("falls back to auth choices when existing-auth completion fails", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { CustomAuthFlow } = await import(
			"../../menu/model_setup/custom-auth-flow.tsx"
		);

		const instance = render(
			React.createElement(CustomAuthFlow, {
				baseUrl: "https://api.openai.com/v1",
				config: null,
				onCancel: () => undefined,
				onComplete: () => Promise.reject(new Error("config write failed")),
				hasExistingKey: () => Promise.resolve(true),
			}),
		);

		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("config write failed"),
		);
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("Failed to use existing authentication");
		expect(frame).toContain("Enter OpenAI API key");
	});

	it("uses the latest existing-auth completion after callback rerender", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { CustomAuthFlow } = await import(
			"../../menu/model_setup/custom-auth-flow.tsx"
		);
		const existingAuth = deferred<boolean>();
		const completions: string[] = [];
		let checks = 0;
		const hasExistingKey = () => {
			checks += 1;
			return existingAuth.promise;
		};
		const renderFlow = (marker: string) =>
			React.createElement(CustomAuthFlow, {
				baseUrl: "https://api.openai.com/v1",
				config: null,
				onCancel: () => undefined,
				onComplete: () => completions.push(marker),
				hasExistingKey,
			});
		const instance = render(renderFlow("old"));

		instance.rerender(renderFlow("new"));
		existingAuth.resolve(true);
		await waitFor(() => completions.length === 1);

		expect(checks).toBe(1);
		expect(completions).toEqual(["new"]);
		expect(instance.lastFrame() ?? "").toContain(
			"Checking existing authentication",
		);
	});

	it("does not repeat existing-auth completion while completion is in flight", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { CustomAuthFlow } = await import(
			"../../menu/model_setup/custom-auth-flow.tsx"
		);
		const completion = deferred<void>();
		let completions = 0;
		let checks = 0;

		const renderFlow = (marker: string) =>
			React.createElement(CustomAuthFlow, {
				baseUrl: "https://api.openai.com/v1",
				config: null,
				onCancel: () => marker,
				onComplete: () => {
					completions += 1;
					return completion.promise;
				},
				hasExistingKey: () => {
					checks += 1;
					return Promise.resolve(true);
				},
			});

		const instance = render(renderFlow("first"));
		await waitFor(() => completions === 1);
		instance.rerender(renderFlow("second"));
		await Bun.sleep(25);

		expect(checks).toBe(1);
		expect(completions).toBe(1);
		expect(instance.lastFrame() ?? "").toContain(
			"Checking existing authentication",
		);
		completion.resolve();
	});

	it("does not flash auth choices after existing auth completes", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { CustomAuthFlow } = await import(
			"../../menu/model_setup/custom-auth-flow.tsx"
		);
		let completions = 0;

		const instance = render(
			React.createElement(CustomAuthFlow, {
				baseUrl: "https://api.openai.com/v1",
				config: null,
				onCancel: () => undefined,
				onComplete: () => {
					completions += 1;
				},
				hasExistingKey: () => Promise.resolve(true),
			}),
		);

		await waitFor(() => completions === 1);
		await Bun.sleep(25);
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("Checking existing authentication");
		expect(frame).not.toContain("Enter an API key");
	});

	it("completes with existing OpenAI OAuth auth without showing API-key choices", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { CustomAuthFlow } = await import(
			"../../menu/model_setup/custom-auth-flow.tsx"
		);
		const completed: unknown[] = [];

		const instance = render(
			React.createElement(CustomAuthFlow, {
				baseUrl: "https://api.openai.com/v1",
				config: null,
				onCancel: () => undefined,
				onComplete: (auth: unknown) => {
					completed.push(auth);
				},
				hasExistingKey: () =>
					Promise.resolve({
						type: "env" as const,
						name: "CODEX_ACCESS_TOKEN",
						credential: "chatgpt-oauth" as const,
					}),
			}),
		);

		await waitFor(() => completed.length === 1);
		await Bun.sleep(25);
		const frame = instance.lastFrame() ?? "";
		expect(completed).toEqual([
			{
				type: "env",
				name: "CODEX_ACCESS_TOKEN",
				credential: "chatgpt-oauth",
			},
		]);
		expect(frame).toContain("Checking existing authentication");
		expect(frame).not.toContain("Enter an API key");
	});

	it("prefers OpenAI OAuth env auth before stored API-key auth in the default check", async () => {
		const { hasExistingKeyForAuthFlow } = await import(
			"../../menu/model_setup/custom-auth-flow.tsx"
		);
		const { PROVIDERS } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		await expect(
			hasExistingKeyForAuthFlow(
				"https://api.openai.com/v1",
				{
					yourName: "Ada",
					models: [],
					defaultApiKeyOverrides: { openai: "PATH" },
				},
				expectPresent(PROVIDERS.openai),
				{ CODEX_ACCESS_TOKEN: "oauth-token" },
			),
		).resolves.toEqual({
			type: "env",
			name: "CODEX_ACCESS_TOKEN",
			credential: "chatgpt-oauth",
		});
	});

	it("uses provider API-key env auth in the default existing-auth check", async () => {
		const { hasExistingKeyForAuthFlow } = await import(
			"../../menu/model_setup/custom-auth-flow.tsx"
		);
		const { PROVIDERS } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);

		await expect(
			hasExistingKeyForAuthFlow(
				"https://api.anthropic.com",
				null,
				expectPresent(PROVIDERS.anthropic),
				{ ANTHROPIC_API_KEY: "anthropic-key" },
			),
		).resolves.toBe(true);
	});

	it("preserves provider auth metadata when a selected provider uses a base URL override", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { CustomAuthFlow } = await import(
			"../../menu/model_setup/custom-auth-flow.tsx"
		);
		const { PROVIDERS } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);

		const openai = expectPresent(PROVIDERS.openai);
		const env = {};
		const existingKeyChecks: unknown[] = [];
		const instance = render(
			React.createElement(CustomAuthFlow, {
				baseUrl: "http://127.0.0.1:8080/v1",
				provider: { ...openai, baseUrl: "http://127.0.0.1:8080/v1" },
				config: null,
				onCancel: () => undefined,
				onComplete: () => undefined,
				hasExistingKey: (...args: unknown[]) => {
					existingKeyChecks.push(args);
					return Promise.resolve(false);
				},
				env,
			}),
		);

		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("OPENAI_API_KEY"),
		);
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("OpenAI");
		expect(frame).toContain("ChatGPT OAuth");
		expect(frame).toContain("Use ChatGPT OAuth access token");
		expect(frame).toContain("Enter OpenAI API key");
		expect(existingKeyChecks).toEqual([
			[
				"http://127.0.0.1:8080/v1",
				null,
				{ ...openai, baseUrl: "http://127.0.0.1:8080/v1" },
				env,
			],
		]);
	});

	it("keeps auth choices stable when provider metadata is recreated for the same target", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { CustomAuthFlow } = await import(
			"../../menu/model_setup/custom-auth-flow.tsx"
		);
		const { PROVIDERS } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const openai = expectPresent(PROVIDERS.openai);
		let checks = 0;
		const provider = { ...openai, baseUrl: "http://127.0.0.1:8080/v1" };

		const instance = render(
			React.createElement(CustomAuthFlow, {
				baseUrl: provider.baseUrl,
				provider,
				config: null,
				onCancel: () => undefined,
				onComplete: () => undefined,
				hasExistingKey: () => {
					checks += 1;
					return Promise.resolve(false);
				},
			}),
		);

		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("Use ChatGPT OAuth access token"),
		);
		instance.rerender(
			React.createElement(CustomAuthFlow, {
				baseUrl: provider.baseUrl,
				provider: { ...provider },
				config: null,
				onCancel: () => undefined,
				onComplete: () => undefined,
				hasExistingKey: () => {
					checks += 1;
					return Promise.resolve(false);
				},
			}),
		);
		await Bun.sleep(25);

		const frame = instance.lastFrame() ?? "";
		expect(checks).toBe(1);
		expect(frame).toContain("Use ChatGPT OAuth access token");
		expect(frame).not.toContain("Checking existing authentication");
	});

	it("keeps the selected manual auth route when equivalent provider metadata is recreated", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { CustomAuthFlow } = await import(
			"../../menu/model_setup/custom-auth-flow.tsx"
		);
		const { PROVIDERS } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const openai = expectPresent(PROVIDERS.openai);
		const provider = { ...openai, baseUrl: "http://127.0.0.1:8080/v1" };
		let checks = 0;
		const renderFlow = (nextProvider: typeof provider) =>
			React.createElement(CustomAuthFlow, {
				baseUrl: nextProvider.baseUrl,
				provider: nextProvider,
				config: null,
				onCancel: () => undefined,
				onComplete: () => undefined,
				hasExistingKey: () => {
					checks += 1;
					return Promise.resolve(false);
				},
			});

		const instance = render(renderFlow(provider));

		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("Use ChatGPT OAuth access token"),
		);
		await Bun.sleep(25);
		for (let attempt = 0; attempt < 5; attempt += 1) {
			if ((instance.lastFrame() ?? "").includes("Environment variable name:")) {
				break;
			}
			instance.stdin.write("e");
			await Bun.sleep(25);
		}
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("Environment variable name:"),
		);
		instance.rerender(renderFlow({ ...provider }));
		await Bun.sleep(25);

		const frame = instance.lastFrame() ?? "";
		expect(checks).toBe(1);
		expect(frame).toContain("Environment variable name:");
		expect(frame).not.toContain("Use ChatGPT OAuth access token");
		expect(frame).not.toContain("Checking existing authentication");
	});

	it("uses the latest manual auth target after rerender", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { CustomAuthFlow } = await import(
			"../../menu/model_setup/custom-auth-flow.tsx"
		);
		const completed: unknown[] = [];
		const checks: unknown[] = [];
		const renderFlow = (tag: string, env: Record<string, string>) =>
			React.createElement(CustomAuthFlow, {
				baseUrl: `https://${tag}.example.test/v1`,
				config: null,
				onCancel: () => undefined,
				onComplete: (auth: unknown) => completed.push({ tag, auth }),
				hasExistingKey: (baseUrl: string) => {
					checks.push({ tag, baseUrl });
					return Promise.resolve(false);
				},
				env,
			});
		const instance = render(renderFlow("old", {}));

		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("This custom endpoint can use"),
		);
		instance.rerender(renderFlow("new", { LATEST_CUSTOM_AUTH_KEY: "secret" }));
		await waitFor(() => checks.length === 2);
		await Bun.sleep(25);
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("This custom endpoint can use"),
		);
		for (let attempt = 0; attempt < 5; attempt += 1) {
			if ((instance.lastFrame() ?? "").includes("Environment variable name:")) {
				break;
			}
			instance.stdin.write("e");
			await Bun.sleep(25);
		}
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("Environment variable name:"),
		);
		instance.stdin.write("LATEST_CUSTOM_AUTH_KEY");
		await Bun.sleep(25);
		instance.stdin.write("\r");
		await waitFor(() => completed.length === 1);

		expect(checks).toEqual([
			{ tag: "old", baseUrl: "https://old.example.test/v1" },
			{ tag: "new", baseUrl: "https://new.example.test/v1" },
		]);
		expect(completed).toEqual([
			{
				tag: "new",
				auth: {
					type: "env",
					name: "LATEST_CUSTOM_AUTH_KEY",
					credential: "api-key",
				},
			},
		]);
	});

	it("rechecks existing auth when provider env var changes for the same endpoint", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { CustomAuthFlow } = await import(
			"../../menu/model_setup/custom-auth-flow.tsx"
		);
		const { PROVIDERS } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const anthropic = expectPresent(PROVIDERS.anthropic);
		const env = { NEW_ANTHROPIC_KEY: "present" };
		let completions = 0;
		const renderFlow = (envVar: string) =>
			React.createElement(CustomAuthFlow, {
				baseUrl: anthropic.baseUrl,
				provider: { ...anthropic, envVar },
				config: null,
				env,
				onCancel: () => undefined,
				onComplete: () => {
					completions += 1;
				},
				hasExistingKey: (_baseUrl, _config, providerArg, envArg) =>
					Promise.resolve(Boolean(providerArg && envArg[providerArg.envVar])),
			});

		const instance = render(renderFlow("OLD_ANTHROPIC_KEY"));

		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("Use OLD_ANTHROPIC_KEY"),
		);
		instance.rerender(renderFlow("NEW_ANTHROPIC_KEY"));

		await waitFor(() => completions === 1);
		expect(instance.lastFrame() ?? "").toContain(
			"Checking existing authentication",
		);
	});

	it("rechecks existing auth when the auth target changes", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { CustomAuthFlow } = await import(
			"../../menu/model_setup/custom-auth-flow.tsx"
		);
		const { PROVIDERS } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const openai = expectPresent(PROVIDERS.openai);
		const env = {};
		const checks: unknown[] = [];
		let completions = 0;
		const hasExistingKey = (baseUrl: string, ...rest: unknown[]) => {
			checks.push([baseUrl, ...rest]);
			return Promise.resolve(baseUrl === openai.baseUrl);
		};

		const instance = render(
			React.createElement(CustomAuthFlow, {
				baseUrl: "https://models.example.test/v1",
				config: null,
				onCancel: () => undefined,
				onComplete: () => {
					completions += 1;
				},
				hasExistingKey,
				env,
			}),
		);

		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("This custom endpoint can use"),
		);
		instance.rerender(
			React.createElement(CustomAuthFlow, {
				baseUrl: openai.baseUrl,
				provider: openai,
				config: null,
				onCancel: () => undefined,
				onComplete: () => {
					completions += 1;
				},
				hasExistingKey,
				env,
			}),
		);

		await waitFor(() => completions === 1);
		expect(checks).toEqual([
			["https://models.example.test/v1", null, undefined, env],
			[openai.baseUrl, null, openai, env],
		]);
		expect(instance.lastFrame() ?? "").toContain(
			"Checking existing authentication",
		);
	});

	it("clears stale existing-auth errors when the auth target changes", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { CustomAuthFlow } = await import(
			"../../menu/model_setup/custom-auth-flow.tsx"
		);
		const checks: string[] = [];
		const hasExistingKey = (baseUrl: string) => {
			checks.push(baseUrl);
			if (checks.length === 1) {
				return Promise.reject(new Error("old target unavailable"));
			}
			return Promise.resolve(false);
		};

		const instance = render(
			React.createElement(CustomAuthFlow, {
				baseUrl: "https://old-auth.example.test/v1",
				config: null,
				onCancel: () => undefined,
				onComplete: () => undefined,
				hasExistingKey,
			}),
		);

		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("old target unavailable"),
		);
		instance.rerender(
			React.createElement(CustomAuthFlow, {
				baseUrl: "https://new-auth.example.test/v1",
				config: null,
				onCancel: () => undefined,
				onComplete: () => undefined,
				hasExistingKey,
			}),
		);

		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("This custom endpoint can use"),
		);
		const frame = instance.lastFrame() ?? "";
		expect(checks).toEqual([
			"https://old-auth.example.test/v1",
			"https://new-auth.example.test/v1",
		]);
		expect(frame).not.toContain("old target unavailable");
		expect(frame).toContain("Enter an API key");
	});
});
