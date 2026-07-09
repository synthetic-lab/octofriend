import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import { Profiler } from "react";
import { shallow } from "zustand/shallow";
import {
	BottomBar,
	BottomBarContent,
	bottomBarVersionMessage,
	selectBottomBarContentState,
} from "../../app/bottom_bar.tsx";
import type { InputHistory } from "../../app/input_history.ts";
import { useAppStore } from "../../app/state/store.ts";
import { ConfigContext } from "../../internal/configuration/react-context.ts";
import type { Config } from "../../internal/configuration/schemas.ts";

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 500; attempt += 1) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Timed out waiting for condition");
}

const bottomBarConfig: Config = {
	yourName: "Octo",
	models: [
		{
			nickname: "main",
			baseUrl: "https://api.openai.com/v1",
			model: "gpt-4o",
			context: 200_000,
		},
	],
};

describe("terminal bottom bar", () => {
	it("exports the bottom bar components", () => {
		expect(BottomBar).toBeFunction();
		expect(BottomBarContent).toBeFunction();
	});

	it("formats version-check status messages", () => {
		expect(bottomBarVersionMessage("0.0.1", "0.0.2")).toBe(
			"New version released! Run `bun install --global octofwen` to update.",
		);
		expect(bottomBarVersionMessage("0.0.2", "0.0.2")).toBe(
			"Octo is up-to-date.",
		);
		expect(bottomBarVersionMessage("0.0.2", null)).toBe("Octo is up-to-date.");
		expect(bottomBarVersionMessage("0.0.10", "0.0.2")).toBe(
			"Octo is up-to-date.",
		);
		expect(bottomBarVersionMessage("0.9.9", "0.10.0")).toBe(
			"New version released! Run `bun install --global octofwen` to update.",
		);
		expect(bottomBarVersionMessage("v0.9.9", "v0.10.0")).toBe(
			"New version released! Run `bun install --global octofwen` to update.",
		);
		expect(bottomBarVersionMessage("1.0.0-beta", "1.0.0")).toBe(
			"Octo is up-to-date.",
		);
	});

	it("keeps bottom-bar content selector stable for equivalent input mode payloads", () => {
		const previousModeData = useAppStore.getState().modeData;
		useAppStore.setState({ modeData: { mode: "input", vimMode: "INSERT" } });

		try {
			const before = selectBottomBarContentState(useAppStore.getState());
			useAppStore.setState({ modeData: { mode: "input", vimMode: "INSERT" } });
			const after = selectBottomBarContentState(useAppStore.getState());

			expect(shallow(before, after)).toBe(true);
		} finally {
			useAppStore.setState({ modeData: previousModeData });
		}
	});

	it("ignores query churn while input is not rendered", () => {
		const previousState = useAppStore.getState();
		useAppStore.setState({
			modeData: { mode: "error-recovery" },
			query: "before",
		});

		try {
			const before = selectBottomBarContentState(useAppStore.getState());
			useAppStore.setState({ query: "after" });
			const after = selectBottomBarContentState(useAppStore.getState());

			expect(before.query).toBe("");
			expect(shallow(before, after)).toBe(true);
		} finally {
			useAppStore.setState(previousState);
		}
	});

	it("ignores input callback churn while input is not rendered", () => {
		const previousState = useAppStore.getState();
		useAppStore.setState({
			modeData: { mode: "error-recovery" },
			input: async () => undefined,
		});

		try {
			const before = selectBottomBarContentState(useAppStore.getState());
			useAppStore.setState({ input: async () => undefined });
			const after = selectBottomBarContentState(useAppStore.getState());

			expect(before.input).toBeNull();
			expect(shallow(before, after)).toBe(true);
		} finally {
			useAppStore.setState(previousState);
		}
	});

	it("uses the latest bottom-bar input action after store rerender", async () => {
		const previousState = useAppStore.getState();
		const calls: string[] = [];
		const inputHistory: InputHistory = {
			getCurrentHistory: () => [],
			appendToInputHistory: () => Promise.resolve(),
			close: () => undefined,
		};

		try {
			useAppStore.setState({
				modeData: { mode: "input", vimMode: "INSERT" },
				query: "",
				openMenu: () => {
					calls.push("first");
				},
			});
			const instance = render(
				<ConfigContext.Provider value={bottomBarConfig}>
					<BottomBarContent
						inputHistory={inputHistory}
						trajectoryArcRun={undefined as never}
						toolPermission={undefined as never}
						skillDiscover={undefined as never}
						toolDefinitions={undefined as never}
						toolRun={undefined as never}
					/>
				</ConfigContext.Provider>,
			);

			useAppStore.setState({
				openMenu: () => {
					calls.push("second");
				},
			});
			await waitFor(() =>
				(instance.lastFrame() ?? "").includes("Ctrl+p to enter the menu"),
			);
			instance.stdin.write("\x10");
			await waitFor(() => calls.length > 0);

			expect(calls).toEqual(["second"]);
			instance.unmount();
		} finally {
			useAppStore.setState(previousState);
		}
	});

	it("does not rerender hidden input controls when only the active model changes", async () => {
		const previousState = useAppStore.getState();
		let renders = 0;
		const inputHistory: InputHistory = {
			getCurrentHistory: () => [],
			appendToInputHistory: () => Promise.resolve(),
			close: () => undefined,
		};
		const config: Config = {
			yourName: "Octo",
			models: [
				{
					nickname: "one",
					baseUrl: "https://api.openai.com/v1",
					model: "model-one",
					context: 128000,
				},
				{
					nickname: "two",
					baseUrl: "https://api.openai.com/v1",
					model: "model-two",
					context: 128000,
				},
			],
		};

		try {
			useAppStore.setState({
				modeData: {
					mode: "responding",
					inflightResponse: { type: "inflight-response", content: "" },
					abortController: new AbortController(),
				},
				byteCount: 0,
				modelOverride: "model-one",
			});
			const instance = render(
				<ConfigContext.Provider value={config}>
					<Profiler
						id="bottom-bar-content"
						onRender={() => {
							renders += 1;
						}}
					>
						<BottomBarContent
							inputHistory={inputHistory}
							trajectoryArcRun={undefined as never}
							toolPermission={undefined as never}
							skillDiscover={undefined as never}
							toolDefinitions={undefined as never}
							toolRun={undefined as never}
						/>
					</Profiler>
				</ConfigContext.Provider>,
			);

			await waitFor(() => (instance.lastFrame() ?? "").includes("ESC"));
			const before = renders;
			useAppStore.setState({ modelOverride: "model-two" });
			await Bun.sleep(5);

			expect(renders).toBe(before);
			instance.unmount();
		} finally {
			useAppStore.setState(previousState, true);
		}
	});

	it("ignores byte-count churn outside streaming progress modes", () => {
		const previousState = useAppStore.getState();
		useAppStore.setState({
			modeData: { mode: "error-recovery" },
			byteCount: 12,
		});

		try {
			const before = selectBottomBarContentState(useAppStore.getState());
			useAppStore.setState({ byteCount: 34 });
			const after = selectBottomBarContentState(useAppStore.getState());

			expect(before.byteCount).toBe(0);
			expect(shallow(before, after)).toBe(true);
		} finally {
			useAppStore.setState(previousState);
		}
	});

	it("normalizes CR line breaks in temporary notifications", async () => {
		const originalFetch = globalThis.fetch;
		const previousState = useAppStore.getState();
		const inputHistory: InputHistory = {
			getCurrentHistory: () => [],
			appendToInputHistory: () => Promise.resolve(),
			close: () => undefined,
		};

		globalThis.fetch = (() =>
			Promise.resolve({
				json: () => Promise.resolve({ "dist-tags": { latest: "0.0.1" } }),
			} as Response)) as unknown as typeof fetch;

		try {
			useAppStore.setState({ modeData: { mode: "input", vimMode: "INSERT" } });
			const instance = render(
				<ConfigContext.Provider value={bottomBarConfig}>
					<BottomBar
						inputHistory={inputHistory}
						metadata={{ version: "0.0.1" }}
						tempNotification={"first\r\nsecond\rthird"}
					/>
				</ConfigContext.Provider>,
			);

			await waitFor(() => (instance.lastFrame() ?? "").includes("first"));
			const frame = instance.lastFrame() ?? "";
			expect(frame).toContain("first");
			expect(frame).toContain("second");
			expect(frame).toContain("third");
			expect(frame).not.toContain("\r");
			instance.unmount();
		} finally {
			globalThis.fetch = originalFetch;
			useAppStore.setState(previousState, true);
		}
	});

	it("does not run version checks while the menu owns the bottom bar", async () => {
		const originalFetch = globalThis.fetch;
		const previousModeData = useAppStore.getState().modeData;
		const calls: unknown[] = [];
		const inputHistory: InputHistory = {
			getCurrentHistory: () => [],
			appendToInputHistory: () => Promise.resolve(),
			close: () => undefined,
		};

		globalThis.fetch = ((...args: unknown[]) => {
			calls.push(args);
			return Promise.resolve({
				json: () => Promise.resolve({ "dist-tags": { latest: "9.9.9" } }),
			} as Response);
		}) as unknown as typeof fetch;

		try {
			useAppStore.setState({ modeData: { mode: "menu" } });
			const instance = render(
				<BottomBar
					inputHistory={inputHistory}
					metadata={{ version: "0.0.1" }}
					tempNotification={null}
				/>,
			);

			await Bun.sleep(10);

			expect(calls).toEqual([]);
			instance.unmount();
		} finally {
			globalThis.fetch = originalFetch;
			useAppStore.setState({ modeData: previousModeData });
		}
	});

	it("clears pending version-check timers on unmount", async () => {
		const originalFetch = globalThis.fetch;
		const originalSetTimeout = globalThis.setTimeout;
		const originalClearTimeout = globalThis.clearTimeout;
		const previousModeData = useAppStore.getState().modeData;
		type TestTimer = ReturnType<typeof setTimeout> & { timeout?: number };
		const timers: TestTimer[] = [];
		const cleared: (ReturnType<typeof setTimeout> | undefined)[] = [];
		let resolveFetch: (() => void) | undefined;
		const fetchReady = new Promise<void>((resolve) => {
			resolveFetch = resolve;
		});
		const inputHistory: InputHistory = {
			getCurrentHistory: () => [],
			appendToInputHistory: () => Promise.resolve(),
			close: () => undefined,
		};

		globalThis.fetch = (() =>
			fetchReady.then(
				() =>
					({
						json: () => Promise.resolve({ "dist-tags": { latest: "0.0.1" } }),
					}) as Response,
			)) as unknown as typeof fetch;

		try {
			useAppStore.setState({ modeData: { mode: "auth-error", error: "auth" } });
			const instance = render(
				<BottomBar
					inputHistory={inputHistory}
					metadata={{ version: "0.0.1" }}
					tempNotification={null}
				/>,
			);

			globalThis.setTimeout = ((handler: TimerHandler, timeout?: number) => {
				const timer = { handler, timeout } as unknown as TestTimer;
				timers.push(timer);
				return timer;
			}) as unknown as typeof setTimeout;
			globalThis.clearTimeout = ((timer?: ReturnType<typeof setTimeout>) => {
				cleared.push(timer);
			}) as unknown as typeof clearTimeout;

			resolveFetch?.();
			await waitFor(() => timers.some((timer) => timer.timeout === 5000));
			const versionTimer = timers.find((timer) => timer.timeout === 5000);
			expect(versionTimer).toBeDefined();

			instance.unmount();
			expect(cleared).toContain(versionTimer);
		} finally {
			globalThis.fetch = originalFetch;
			globalThis.setTimeout = originalSetTimeout;
			globalThis.clearTimeout = originalClearTimeout;
			useAppStore.setState({ modeData: previousModeData });
		}
	});
});
