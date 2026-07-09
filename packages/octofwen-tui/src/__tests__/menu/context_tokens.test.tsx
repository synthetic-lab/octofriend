import { describe, expect, it } from "bun:test";

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Timed out waiting for condition");
}

describe("terminal model setup context tokens", () => {
	it("parses context token inputs without allocating around the k suffix", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { errorContext } = await import(
			"../../menu/model_setup/add-model-error-context.tsx"
		);
		const { Context } = await import(
			"../../menu/model_setup/add-model-route-components.tsx"
		);
		const submissions: unknown[] = [];

		const instance = render(
			React.createElement(
				errorContext.Provider,
				{ value: { errorMessage: "", setErrorMessage: () => undefined } },
				React.createElement(Context, {
					baseUrl: "https://api.openai.com/v1",
					model: "gpt-test",
					nickname: "GPT Test",
					auth: {
						type: "env",
						name: "OPENAI_API_KEY",
						credential: "api-key",
					},
					metadata: { name: "GPT Test", contextLength: 0 },
					done: (model: unknown) => submissions.push(model),
					renderExamples: false,
					cancel: () => undefined,
					config: null,
					back: () => undefined,
				}),
			),
		);

		await Bun.sleep(1);
		instance.stdin.write("1k2");
		await waitFor(() => (instance.lastFrame() ?? "").includes("1k2"));
		instance.stdin.write("\r");
		await waitFor(() => submissions.length === 1);

		expect(submissions).toEqual([
			{
				baseUrl: "https://api.openai.com/v1",
				model: "gpt-test",
				nickname: "GPT Test",
				context: 12 * 1024,
				auth: {
					type: "env",
					name: "OPENAI_API_KEY",
					credential: "api-key",
				},
			},
		]);
	});
});
