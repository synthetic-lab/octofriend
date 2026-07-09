import { describe, expect, it } from "bun:test";

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Timed out waiting for condition");
}

describe("model setup module boundaries", () => {
	it("exports the model setup flow components from their owning module", async () => {
		const flowModule = await import(
			"../../menu/model_setup/add-model-flow.tsx"
		);
		const customAuthModule = await import(
			"../../menu/model_setup/custom-auth-flow.tsx"
		);
		const setupModule = await import(
			"../../menu/model_setup/auto-detect-models.tsx"
		);
		const autofixModule = await import(
			"../../menu/model_setup/autofix-model-menu.tsx"
		);

		expect(typeof flowModule.FullAddModelFlow).toBe("function");
		expect(typeof flowModule.CustomModelFlow).toBe("function");
		expect(typeof customAuthModule.CustomAuthFlow).toBe("function");
		expect(typeof flowModule.CustomAutofixFlow).toBe("function");
		expect(typeof setupModule.ModelSetup).toBe("function");
		expect(typeof autofixModule.AutofixModelMenu).toBe("function");
	});

	it("full add-model flow uses latest cancel callback after rerender", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { FullAddModelFlow } = await import(
			"../../menu/model_setup/add-model-flow.tsx"
		);
		const calls: string[] = [];
		const renderFlow = (onCancel: () => void) =>
			React.createElement(FullAddModelFlow, {
				config: {
					yourName: "Ada",
					models: [],
				},
				onComplete: () => undefined,
				onCancel,
			});

		const instance = render(renderFlow(() => calls.push("first:cancel")));
		instance.rerender(renderFlow(() => calls.push("second:cancel")));
		instance.stdin.write("\u001B");
		await waitFor(() => calls.length === 1);

		expect(calls).toEqual(["second:cancel"]);
		instance.unmount();
	});

	it("custom add-model flow uses latest cancel callback after rerender", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { CustomModelFlow } = await import(
			"../../menu/model_setup/add-model-flow.tsx"
		);
		const calls: string[] = [];
		const renderFlow = (onCancel: () => void) =>
			React.createElement(CustomModelFlow, {
				config: {
					yourName: "Ada",
					models: [],
				},
				baseUrl: "https://api.openai.com/v1",
				onComplete: () => undefined,
				onCancel,
			});

		const instance = render(renderFlow(() => calls.push("first:cancel")));
		instance.rerender(renderFlow(() => calls.push("second:cancel")));
		instance.stdin.write("\u001B");
		await waitFor(() => calls.length === 1);

		expect(calls).toEqual(["second:cancel"]);
		instance.unmount();
	});

	it("custom autofix flow uses latest cancel callback after rerender", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { CustomAutofixFlow } = await import(
			"../../menu/model_setup/add-model-flow.tsx"
		);
		const calls: string[] = [];
		const renderFlow = (onCancel: () => void) =>
			React.createElement(CustomAutofixFlow, {
				config: {
					yourName: "Ada",
					models: [],
				},
				onComplete: () => undefined,
				onCancel,
			});

		const instance = render(renderFlow(() => calls.push("first:cancel")));
		instance.rerender(renderFlow(() => calls.push("second:cancel")));
		instance.stdin.write("\u001B");
		await waitFor(() => calls.length === 1);

		expect(calls).toEqual(["second:cancel"]);
		instance.unmount();
	});
});
