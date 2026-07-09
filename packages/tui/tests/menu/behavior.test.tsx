import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import { SetApiKey } from "../../src/menu/models/api-key";

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Timed out waiting for condition");
}

describe("SetApiKey behavior", () => {
	it("uses latest base URL, writer, completion, and cancel callbacks after rerender", async () => {
		const writes: unknown[] = [];
		const completions: string[] = [];
		const cancellations: string[] = [];
		const instance = render(
			<SetApiKey
				baseUrl="https://old.example/v1"
				onComplete={(apiKey) => {
					completions.push(`old:${apiKey}`);
				}}
				onCancel={() => cancellations.push("old")}
				writeKey={(model, apiKey) => {
					writes.push({ model, apiKey, writer: "old" });
					return Promise.resolve();
				}}
			/>,
		);

		await Bun.sleep(1);
		instance.stdin.write("sk-latest");
		await waitFor(() => (instance.lastFrame() ?? "").includes("••••"));
		instance.rerender(
			<SetApiKey
				baseUrl="https://new.example/v1"
				onComplete={(apiKey) => {
					completions.push(`new:${apiKey}`);
				}}
				onCancel={() => cancellations.push("new")}
				writeKey={(model, apiKey) => {
					writes.push({ model, apiKey, writer: "new" });
					return Promise.resolve();
				}}
			/>,
		);
		instance.stdin.write("\r");
		await waitFor(() => completions.length === 1);

		expect(writes).toEqual([
			{
				model: { baseUrl: "https://new.example/v1" },
				apiKey: "sk-latest",
				writer: "new",
			},
		]);
		expect(completions).toEqual(["new:sk-latest"]);
		expect(cancellations).toEqual([]);
	});

	it("uses latest cancel callback after rerender", async () => {
		const cancellations: string[] = [];
		const instance = render(
			<SetApiKey
				baseUrl="https://api.openai.com/v1"
				onComplete={() => undefined}
				onCancel={() => cancellations.push("old")}
			/>,
		);

		instance.rerender(
			<SetApiKey
				baseUrl="https://api.openai.com/v1"
				onComplete={() => undefined}
				onCancel={() => cancellations.push("new")}
			/>,
		);
		instance.stdin.write("\x1B");
		await waitFor(() => cancellations.length === 1);

		expect(cancellations).toEqual(["new"]);
	});
});
