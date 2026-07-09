import { describe, expect, it } from "bun:test";

import { deferred, waitFor } from "./test-support.ts";

describe("terminal model setup connection tests", () => {
	it("does not repeat connection tests when rerendering the same target", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { ModelConnectionTestContext } = await import(
			"../../menu/model_setup/add-model-connection.ts"
		);
		const { errorContext } = await import(
			"../../menu/model_setup/add-model-error-context.tsx"
		);
		const { TestConnection } = await import(
			"../../menu/model_setup/add-model-route-components.tsx"
		);
		const calls: unknown[] = [];
		const connection = deferred<{
			valid: true;
			metadata: { name: string; contextLength: number };
		}>();
		const env = { MODEL_SETUP_RERENDER_TEST_KEY: "test-key" };
		const modelConnectionTest = (params: unknown) => {
			calls.push(params);
			return connection.promise;
		};
		const renderRoute = (submitLabel: string) =>
			React.createElement(
				ModelConnectionTestContext.Provider,
				{ value: modelConnectionTest },
				React.createElement(
					errorContext.Provider,
					{
						value: {
							errorMessage: "",
							setErrorMessage: () => undefined,
						},
					},
					React.createElement(TestConnection, {
						baseUrl: "https://api.openai.com/v1",
						model: "gpt-5.4-mini",
						auth: {
							type: "env",
							name: "MODEL_SETUP_RERENDER_TEST_KEY",
							credential: "api-key",
						},
						config: null,
						renderExamples: false,
						done: () => undefined,
						cancel: () => undefined,
						back: () => undefined,
						errorNav: () => undefined,
						onSubmit: () => submitLabel,
						env,
					}),
				),
			);

		const instance = render(renderRoute("first"));
		await waitFor(() => calls.length === 1);

		instance.rerender(renderRoute("second"));
		await Bun.sleep(1);

		expect(calls).toHaveLength(1);
	});

	it("retests model connections when env auth values change", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { ModelConnectionTestContext } = await import(
			"../../menu/model_setup/add-model-connection.ts"
		);
		const { errorContext } = await import(
			"../../menu/model_setup/add-model-error-context.tsx"
		);
		const { TestConnection } = await import(
			"../../menu/model_setup/add-model-route-components.tsx"
		);
		const calls: unknown[] = [];
		const modelConnectionTest = (params: unknown) => {
			calls.push(params);
			return Promise.resolve({
				valid: true as const,
				metadata: { name: "test model", contextLength: 128000 },
			});
		};
		const renderRoute = (apiKey: string) =>
			React.createElement(
				ModelConnectionTestContext.Provider,
				{ value: modelConnectionTest },
				React.createElement(
					errorContext.Provider,
					{
						value: {
							errorMessage: "",
							setErrorMessage: () => undefined,
						},
					},
					React.createElement(TestConnection, {
						baseUrl: "https://api.openai.com/v1",
						model: "gpt-5.4-mini",
						auth: {
							type: "env",
							name: "MODEL_SETUP_ENV_CHANGE_KEY",
							credential: "api-key",
						},
						config: null,
						renderExamples: false,
						done: () => undefined,
						cancel: () => undefined,
						back: () => undefined,
						errorNav: () => undefined,
						onSubmit: () => undefined,
						env: { MODEL_SETUP_ENV_CHANGE_KEY: apiKey },
					}),
				),
			);

		const instance = render(renderRoute("old-key"));
		await waitFor(() => calls.length === 1);

		instance.rerender(renderRoute("new-key"));
		await waitFor(() => calls.length === 2);

		expect(calls).toEqual([
			expect.objectContaining({ apiKey: "old-key" }),
			expect.objectContaining({ apiKey: "new-key" }),
		]);
	});

	it("ignores stale connection test results after rerendering the route", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { ModelConnectionTestContext } = await import(
			"../../menu/model_setup/add-model-connection.ts"
		);
		const { errorContext } = await import(
			"../../menu/model_setup/add-model-error-context.tsx"
		);
		const { TestConnection } = await import(
			"../../menu/model_setup/add-model-route-components.tsx"
		);
		const first = deferred<{ valid: false }>();
		const second = deferred<{
			valid: true;
			metadata: { name: string; contextLength: number };
		}>();
		const calls: unknown[] = [];
		const errors: string[] = [];
		const errorNavs: string[] = [];
		const submits: unknown[] = [];
		const env = { MODEL_SETUP_STALE_TEST_KEY: "test-key" };
		const modelConnectionTest = (params: unknown) => {
			calls.push(params);
			return calls.length === 1 ? first.promise : second.promise;
		};
		const renderRoute = (model: string) =>
			React.createElement(
				ModelConnectionTestContext.Provider,
				{ value: modelConnectionTest },
				React.createElement(
					errorContext.Provider,
					{
						value: {
							errorMessage: "",
							setErrorMessage: (message: string) => errors.push(message),
						},
					},
					React.createElement(TestConnection, {
						baseUrl: "https://api.openai.com/v1",
						model,
						auth: {
							type: "env",
							name: "MODEL_SETUP_STALE_TEST_KEY",
							credential: "api-key",
						},
						config: null,
						renderExamples: false,
						done: () => undefined,
						cancel: () => undefined,
						back: () => undefined,
						errorNav: () => errorNavs.push(model),
						onSubmit: (metadata: unknown) => submits.push({ model, metadata }),
						env,
					}),
				),
			);

		const instance = render(renderRoute("old-model"));
		await waitFor(() => calls.length === 1);

		instance.rerender(renderRoute("new-model"));
		await waitFor(() => calls.length === 2);

		first.resolve({ valid: false });
		await Bun.sleep(0);
		expect(errors).toEqual([]);
		expect(errorNavs).toEqual([]);

		second.resolve({
			valid: true,
			metadata: { name: "new model", contextLength: 128000 },
		});
		await Bun.sleep(0);
		expect(submits).toEqual([
			{
				model: "new-model",
				metadata: { name: "new model", contextLength: 128000 },
			},
		]);
	});
});
