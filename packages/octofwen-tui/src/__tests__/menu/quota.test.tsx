import { describe, expect, it } from "bun:test";
import { access } from "node:fs/promises";
import { render } from "ink-testing-library";
import {
	MenuQuotaIndicator,
	SyntheticQuotaFetchContext,
} from "../../menu/quota.tsx";

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
