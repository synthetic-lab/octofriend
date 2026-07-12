import { describe, expect, it } from "bun:test";

import { deferred, expectOk, expectPresent, waitFor } from "./test-support.ts";

describe("terminal Synthetic autofix model menu", () => {
	it("shows progress and ignores duplicate Synthetic autofix selections", async () => {
		const React = await import("react");
		const { Text } = await import("ink");
		const { render } = await import("ink-testing-library");
		const { SYNTHETIC_PROVIDER } = await import(
			"../../src/runtime/models/catalog/main.ts"
		);
		const { ModelConnectionTestContext } = await import(
			"../../src/menu/models/connection.ts"
		);
		const { AutofixModelMenu } = await import(
			"../../src/menu/models/autofix-menu.tsx"
		);
		const syntheticProvider = expectPresent(SYNTHETIC_PROVIDER);
		const connection = deferred<{
			valid: true;
			metadata: Record<string, never>;
		}>();
		const connectionChecks: unknown[] = [];
		const completed: unknown[] = [];
		const instance = render(
			React.createElement(
				ModelConnectionTestContext.Provider,
				{
					value: (params: unknown) => {
						connectionChecks.push(params);
						return connection.promise;
					},
				},
				React.createElement(AutofixModelMenu, {
					config: {
						yourName: "Test User",
						models: [],
					},
					defaultModel: "hf:syntheticlab/diff-apply",
					modelNickname: "diff-apply",
					onCancel: () => undefined,
					onComplete: (config: unknown) => completed.push(config),
					onOverrideDefaultApiKey: async () => undefined,
					children: React.createElement(Text, null, "diff apply setup"),
					env: { [syntheticProvider.envVar]: "synthetic-progress-key" },
				}),
			),
		);

		instance.stdin.write("e");
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes(
				"Checking diff-apply Synthetic model...",
			),
		);
		instance.stdin.write("e");
		await Bun.sleep(1);

		expect(connectionChecks).toHaveLength(1);
		expect(completed).toHaveLength(0);
		connection.resolve({ valid: true, metadata: {} });
		await waitFor(() => completed.length === 1);
		expect(instance.lastFrame() ?? "").toContain(
			"Checking diff-apply Synthetic model...",
		);
	});

	it("renders Synthetic autofix connection errors in the per-model menu", async () => {
		const React = await import("react");
		const { Text } = await import("ink");
		const { render } = await import("ink-testing-library");
		const { keyFromName, SYNTHETIC_PROVIDER } = await import(
			"../../src/runtime/models/catalog/main.ts"
		);
		const { ModelConnectionTestContext } = await import(
			"../../src/menu/models/connection.ts"
		);
		const { AutofixModelMenu } = await import(
			"../../src/menu/models/autofix-menu.tsx"
		);
		const syntheticKey = expectOk(
			keyFromName(expectPresent(SYNTHETIC_PROVIDER).name),
		);
		const instance = render(
			React.createElement(
				ModelConnectionTestContext.Provider,
				{
					value: async () => Promise.reject(new Error("billing required")),
				},
				React.createElement(AutofixModelMenu, {
					config: {
						yourName: "Test User",
						models: [],
						defaultApiKeyOverrides: {
							[syntheticKey]: "SYNTHETIC_UI_ERROR_KEY",
						},
					},
					defaultModel: "hf:syntheticlab/diff-apply",
					modelNickname: "diff-apply",
					onCancel: () => undefined,
					onComplete: () => undefined,
					onOverrideDefaultApiKey: async () => undefined,
					children: React.createElement(Text, null, "diff apply setup"),
					env: { SYNTHETIC_UI_ERROR_KEY: "ui-key" },
				}),
			),
		);

		instance.stdin.write("e");
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("billing required"),
		);

		expect(instance.lastFrame() ?? "").toContain("billing required");
	});

	it("preserves Synthetic autofix env auth selected in the per-model menu", async () => {
		const React = await import("react");
		const { Text } = await import("ink");
		const { render } = await import("ink-testing-library");
		const { SYNTHETIC_PROVIDER } = await import(
			"../../src/runtime/models/catalog/main.ts"
		);
		const { ModelConnectionTestContext } = await import(
			"../../src/menu/models/connection.ts"
		);
		const { AutofixModelMenu } = await import(
			"../../src/menu/models/autofix-menu.tsx"
		);
		const syntheticProvider = expectPresent(SYNTHETIC_PROVIDER);
		const completed: unknown[] = [];
		const overrides: string[] = [];
		const connectionChecks: unknown[] = [];

		const instance = render(
			React.createElement(
				ModelConnectionTestContext.Provider,
				{
					value: (params: unknown) => {
						connectionChecks.push(params);
						return Promise.resolve({ valid: true, metadata: {} });
					},
				},
				React.createElement(AutofixModelMenu, {
					config: {
						yourName: "Test User",
						models: [],
					},
					defaultModel: "hf:syntheticlab/diff-apply",
					modelNickname: "diff-apply",
					onCancel: () => undefined,
					onComplete: (config: unknown) => completed.push(config),
					onOverrideDefaultApiKey: (envVar) => {
						overrides.push(envVar);
						return Promise.resolve();
					},
					children: React.createElement(Text, null, "diff apply setup"),
					env: {
						SYNTHETIC_UI_MENU_KEY: "ui-menu-key",
						SYNTHETIC_BASE_URL: " http://127.0.0.1:8080/v1 ",
						[syntheticProvider.envVar]: undefined,
					},
				}),
			),
		);

		instance.stdin.write("e");
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("How do you want to authenticate?"),
		);
		await Bun.sleep(25);
		instance.stdin.write("e");
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("Environment variable name:"),
		);
		await Bun.sleep(25);
		instance.stdin.write("SYNTHETIC_UI_MENU_KEY");
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("SYNTHETIC_UI_MENU_KEY"),
		);
		instance.stdin.write("\r");
		await waitFor(() => completed.length === 1);

		expect(overrides).toEqual(["SYNTHETIC_UI_MENU_KEY"]);
		expect(connectionChecks).toEqual([
			{
				type: "standard",
				baseUrl: "http://127.0.0.1:8080/v1",
				apiKey: "ui-menu-key",
				model: "hf:syntheticlab/diff-apply",
			},
		]);
		expect(completed).toEqual([
			{
				baseUrl: "http://127.0.0.1:8080/v1",
				auth: {
					type: "env",
					name: "SYNTHETIC_UI_MENU_KEY",
					credential: "api-key",
				},
				model: "hf:syntheticlab/diff-apply",
			},
		]);
	});

	it("routes Escape inside Synthetic auth setup back to autofix choices", async () => {
		const React = await import("react");
		const { Text } = await import("ink");
		const { render } = await import("ink-testing-library");
		const { keyFromName, SYNTHETIC_PROVIDER } = await import(
			"../../src/runtime/models/catalog/main.ts"
		);
		const { AutofixModelMenu } = await import(
			"../../src/menu/models/autofix-menu.tsx"
		);
		const syntheticProvider = expectPresent(SYNTHETIC_PROVIDER);
		const syntheticKey = expectOk(keyFromName(syntheticProvider.name));
		const cancels: string[] = [];
		const instance = render(
			React.createElement(AutofixModelMenu, {
				config: {
					yourName: "Test User",
					models: [],
					defaultApiKeyOverrides: {
						[syntheticKey]: "SYNTHETIC_UI_MISSING_AUTH_KEY",
					},
				},
				defaultModel: "hf:syntheticlab/diff-apply",
				modelNickname: "diff-apply",
				onCancel: () => cancels.push("cancel"),
				onComplete: () => undefined,
				onOverrideDefaultApiKey: async () => undefined,
				children: React.createElement(Text, null, "diff apply setup"),
				env: {
					[syntheticProvider.envVar]: undefined,
					SYNTHETIC_UI_MISSING_AUTH_KEY: undefined,
				},
			}),
		);

		instance.stdin.write("e");
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("How do you want to authenticate?"),
		);
		await Bun.sleep(25);
		instance.stdin.write("\u001B");
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("Enable diff-apply model"),
		);

		expect(cancels).toEqual([]);
		instance.unmount();
	});

	it("routes Escape inside custom autofix setup back to autofix choices", async () => {
		const React = await import("react");
		const { Text } = await import("ink");
		const { render } = await import("ink-testing-library");
		const { AutofixModelMenu } = await import(
			"../../src/menu/models/autofix-menu.tsx"
		);
		const cancels: string[] = [];
		const instance = render(
			React.createElement(AutofixModelMenu, {
				config: {
					yourName: "Test User",
					models: [],
				},
				defaultModel: "hf:syntheticlab/diff-apply",
				modelNickname: "diff-apply",
				onCancel: () => cancels.push("cancel"),
				onComplete: () => undefined,
				onOverrideDefaultApiKey: async () => undefined,
				children: React.createElement(Text, null, "diff apply setup"),
				env: {},
			}),
		);

		instance.stdin.write("c");
		await waitFor(() => (instance.lastFrame() ?? "").includes("Base URL:"));
		instance.stdin.write("\u001B");
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("Enable diff-apply model"),
		);

		expect(cancels).toEqual([]);
		instance.unmount();
	});

	it("uses latest cancel callback after rerender", async () => {
		const React = await import("react");
		const { Text } = await import("ink");
		const { render } = await import("ink-testing-library");
		const { AutofixModelMenu } = await import(
			"../../src/menu/models/autofix-menu.tsx"
		);
		const calls: string[] = [];
		const renderMenu = (onCancel: () => void) =>
			React.createElement(AutofixModelMenu, {
				config: {
					yourName: "Test User",
					models: [],
				},
				defaultModel: "hf:syntheticlab/diff-apply",
				modelNickname: "diff-apply",
				onCancel,
				onComplete: () => undefined,
				onOverrideDefaultApiKey: async () => undefined,
				children: React.createElement(Text, null, "diff apply setup"),
				env: {},
			});

		const instance = render(renderMenu(() => calls.push("first:cancel")));
		instance.rerender(renderMenu(() => calls.push("second:cancel")));
		instance.stdin.write("b");
		await Bun.sleep(0);

		expect(calls).toEqual(["second:cancel"]);
		instance.unmount();
	});

	it("uses latest complete callback after rerender", async () => {
		const React = await import("react");
		const { Text } = await import("ink");
		const { render } = await import("ink-testing-library");
		const { SYNTHETIC_PROVIDER } = await import(
			"../../src/runtime/models/catalog/main.ts"
		);
		const { ModelConnectionTestContext } = await import(
			"../../src/menu/models/connection.ts"
		);
		const { AutofixModelMenu } = await import(
			"../../src/menu/models/autofix-menu.tsx"
		);
		const syntheticProvider = expectPresent(SYNTHETIC_PROVIDER);
		const calls: string[] = [];
		const renderMenu = (onComplete: () => void) =>
			React.createElement(
				ModelConnectionTestContext.Provider,
				{
					value: () => Promise.resolve({ valid: true, metadata: {} }),
				},
				React.createElement(AutofixModelMenu, {
					config: {
						yourName: "Test User",
						models: [],
					},
					defaultModel: "hf:syntheticlab/diff-apply",
					modelNickname: "diff-apply",
					onCancel: () => undefined,
					onComplete,
					onOverrideDefaultApiKey: async () => undefined,
					children: React.createElement(Text, null, "diff apply setup"),
					env: { [syntheticProvider.envVar]: "synthetic-rerender-key" },
				}),
			);

		const instance = render(renderMenu(() => calls.push("first:complete")));
		instance.rerender(renderMenu(() => calls.push("second:complete")));
		instance.stdin.write("e");
		await waitFor(() => calls.length === 1);

		expect(calls).toEqual(["second:complete"]);
		instance.unmount();
	});
});
