import { describe, expect, it } from "bun:test";
import { access } from "node:fs/promises";
import { render } from "ink-testing-library";
import {
	MenuQuotaIndicator,
	SyntheticQuotaFetchContext,
} from "../../src/menu/quota";

const quota = {
	weeklyTokenLimit: {
		remainingCredits: "42",
		maxCredits: "100",
		nextRegenCredits: "10",
		percentRemaining: 42,
		nextRegenAt: new Date(Date.now() + 60_000),
	},
	rollingFiveHourLimit: {
		remaining: 4.25,
		max: 10,
		tickPercent: 0.5,
		nextTickAt: new Date(Date.now() + 60_000),
	},
};

async function waitForCondition(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

async function bunEchoCommand(text: string): Promise<string[]> {
	const script = `console.log(${JSON.stringify(text)})`;
	try {
		await access(process.execPath);
		return [process.execPath, "--eval", script];
	} catch {
		return ["bun", "--eval", script];
	}
}

describe("MenuQuotaIndicator", () => {
	it("renders weekly and rolling quota rows", () => {
		const { lastFrame } = render(<MenuQuotaIndicator quota={quota} />);

		const output = lastFrame() || "";
		expect(output).toContain("Synthetic Quota");
		expect(output).toContain("Weekly credits: 42 / 100 remaining");
		expect(output).toContain("5h request limit: 4.2 / 10 remaining");
		expect(output).toContain("Next regen");
	});

	it("renders nothing without quota data", () => {
		const { lastFrame } = render(<MenuQuotaIndicator quota={null} />);

		expect(lastFrame()).toBe("");
	});

	it("does not refetch quota when the Synthetic model values are unchanged", async () => {
		const requests: unknown[] = [];
		const wireQuota = {
			rollingFiveHourLimit: {
				remaining: 4,
				max: 10,
				tickPercent: 0.5,
				nextTickAt: new Date(Date.now() + 60_000).toISOString(),
			},
		};
		const fetchQuota = async (params: unknown) => {
			await Promise.resolve();
			requests.push(params);
			return { quota: wireQuota };
		};
		const model = {
			baseUrl: "https://api.synthetic.new/v1",
			auth: {
				type: "command" as const,
				command: await bunEchoCommand("stable-key"),
			},
		};
		const config = { yourName: "Test", models: [] };
		const rendered = render(
			<SyntheticQuotaFetchContext.Provider value={fetchQuota}>
				<MenuQuotaIndicator quota={null} config={config} model={model} />
			</SyntheticQuotaFetchContext.Provider>,
		);

		await waitForCondition(() => requests.length === 1);
		rendered.rerender(
			<SyntheticQuotaFetchContext.Provider value={fetchQuota}>
				<MenuQuotaIndicator
					quota={null}
					config={config}
					model={{ baseUrl: model.baseUrl, auth: { ...model.auth } }}
				/>
			</SyntheticQuotaFetchContext.Provider>,
		);

		await Promise.resolve();
		await Promise.resolve();
		expect(requests).toHaveLength(1);
	});

	it("refetches missing quota when local-proxy provider type changes", async () => {
		const requests: unknown[] = [];
		const fetchQuota = async (params: unknown) => {
			await Promise.resolve();
			requests.push(params);
			return { quota: null };
		};
		const config = { yourName: "Test", models: [] };
		const keyReader = async (model: { type?: string }) =>
			model.type === "anthropic" ? "anthropic-local-key" : "openai-local-key";
		const rendered = render(
			<SyntheticQuotaFetchContext.Provider value={fetchQuota}>
				<MenuQuotaIndicator
					quota={null}
					config={config}
					keyReader={keyReader}
					model={{
						type: "openai-responses",
						baseUrl: "http://127.0.0.1:8080/v1",
					}}
				/>
			</SyntheticQuotaFetchContext.Provider>,
		);

		await waitForCondition(() => requests.length === 1);
		rendered.rerender(
			<SyntheticQuotaFetchContext.Provider value={fetchQuota}>
				<MenuQuotaIndicator
					quota={null}
					config={config}
					keyReader={keyReader}
					model={{
						type: "anthropic",
						baseUrl: "http://127.0.0.1:8080/v1",
					}}
				/>
			</SyntheticQuotaFetchContext.Provider>,
		);

		await waitForCondition(() => requests.length === 2);
		expect(requests).toEqual([
			{ apiKey: "openai-local-key" },
			{ apiKey: "anthropic-local-key" },
		]);
	});

	it("clears fetched quota when the Synthetic model auth changes", async () => {
		const requests: unknown[] = [];
		const resolveSecond: Array<(value: { quota: unknown | null }) => void> = [];
		const firstQuota = {
			rollingFiveHourLimit: {
				remaining: 4,
				max: 10,
				tickPercent: 0.5,
				nextTickAt: new Date(Date.now() + 60_000).toISOString(),
			},
		};
		const secondQuota = {
			rollingFiveHourLimit: {
				remaining: 8,
				max: 10,
				tickPercent: 0.5,
				nextTickAt: new Date(Date.now() + 60_000).toISOString(),
			},
		};

		const rendered = render(
			<SyntheticQuotaFetchContext.Provider
				value={async (params) => {
					await Promise.resolve();
					requests.push(params);
					if (requests.length === 1) return { quota: firstQuota };
					return new Promise((resolve) => {
						resolveSecond.push(resolve);
					});
				}}
			>
				<MenuQuotaIndicator
					quota={null}
					config={{ yourName: "Test", models: [] }}
					model={{
						baseUrl: "https://api.synthetic.new/v1",
						auth: {
							type: "command",
							command: await bunEchoCommand("first-key"),
						},
					}}
				/>
			</SyntheticQuotaFetchContext.Provider>,
		);

		await waitForCondition(() =>
			(rendered.lastFrame() || "").includes("4 / 10"),
		);

		rendered.rerender(
			<SyntheticQuotaFetchContext.Provider
				value={async (params) => {
					await Promise.resolve();
					requests.push(params);
					return new Promise((resolve) => {
						resolveSecond.push(resolve);
					});
				}}
			>
				<MenuQuotaIndicator
					quota={null}
					config={{ yourName: "Test", models: [] }}
					model={{
						baseUrl: "https://api.synthetic.new/v1",
						auth: {
							type: "command",
							command: await bunEchoCommand("second-key"),
						},
					}}
				/>
			</SyntheticQuotaFetchContext.Provider>,
		);

		await waitForCondition(() => requests.length === 2);
		expect(rendered.lastFrame() || "").not.toContain("4 / 10");
		resolveSecond.at(-1)?.({ quota: secondQuota });
		await waitForCondition(() =>
			(rendered.lastFrame() || "").includes("8 / 10"),
		);
	});

	it("fetches missing Synthetic quota through the bridge context", async () => {
		const requests: unknown[] = [];
		const wireQuota = {
			rollingFiveHourLimit: {
				remaining: 4.25,
				max: 10,
				tickPercent: 0.5,
				nextTickAt: new Date(Date.now() + 60_000).toISOString(),
			},
		};
		render(
			<SyntheticQuotaFetchContext.Provider
				value={async (params) => {
					await Promise.resolve();
					requests.push(params);
					return { quota: wireQuota };
				}}
			>
				<MenuQuotaIndicator
					quota={null}
					config={{ yourName: "Test", models: [] }}
					model={{
						baseUrl: "https://api.synthetic.new/v1",
						auth: {
							type: "command",
							command: await bunEchoCommand("test-key"),
						},
					}}
				/>
			</SyntheticQuotaFetchContext.Provider>,
		);

		await waitForCondition(() => requests.length > 0);

		expect(requests).toEqual([{ apiKey: "test-key" }]);
	});
});
