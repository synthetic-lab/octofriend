import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import { shallow } from "zustand/shallow";
import type { Config } from "../../src/runtime/config/schemas.ts";
import type { Transport } from "../../src/runtime/workspace/common.ts";
import type { InputHistory } from "../../src/shell/input.ts";
import {
	App,
	buildAppStaticItems,
	selectAppShellState,
	terminalUnchainedNotification,
} from "../../src/shell/shell.tsx";
import { useAppStore } from "../../src/shell/state/store.ts";

const shellConfig: Config = {
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

const shellTransport: Transport = {
	cwd: "/repo",
	writeFile: async () => undefined,
	readFile: async () => "",
	pathExists: async () => true,
	isDirectory: async () => false,
	mkdir: async () => undefined,
	readdir: async () => [],
	modTime: async () => 0,
	resolvePath: async (_signal, filePath) => filePath,
	shell: async () => "",
	close: async () => undefined,
};

const shellInputHistory: InputHistory = {
	getCurrentHistory: () => [],
	appendToInputHistory: () => Promise.resolve(),
	close: () => undefined,
};

describe("terminal app shell", () => {
	it("exports the terminal app component", () => {
		expect(App).toBeFunction();
	});

	it("formats unchained-mode notifications", () => {
		expect(terminalUnchainedNotification(true)).toBe(
			"Octo runs edits and shell commands automatically",
		);
		expect(terminalUnchainedNotification(false)).toBe(
			"Octo asks permission before running edits or shell commands",
		);
	});

	it("builds static shell items in stable render order", () => {
		expect(
			buildAppStaticItems({
				metadata: { version: "0.0.1" },
				config: shellConfig,
				bootSkills: ["alpha", "beta"],
				updates: "1.2.3",
				history: [],
			}),
		).toEqual([
			{ type: "header" },
			{ type: "version", metadata: { version: "0.0.1" }, config: shellConfig },
			{ type: "boot-notification", content: " " },
			{ type: "boot-notification", content: "Configured skills:" },
			{ type: "boot-notification", content: "- alpha" },
			{ type: "boot-notification", content: "- beta" },
			{ type: "updates", updates: "1.2.3" },
			{ type: "slogan" },
		]);
	});

	it("uses the latest ready-notification cancellation after store rerender", async () => {
		const previousState = useAppStore.getState();
		const originalFetch = globalThis.fetch;
		const calls: string[] = [];
		globalThis.fetch = (() =>
			Promise.resolve({
				json: () => Promise.resolve({ "dist-tags": { latest: "0.0.1" } }),
			} as Response)) as unknown as typeof fetch;

		try {
			useAppStore.setState({
				modeData: { mode: "error-recovery" },
				cancelNotifyReadyForInput: () => {
					calls.push("first");
				},
			});
			const instance = render(
				<App
					config={shellConfig}
					configPath="/tmp/octofriend.json5"
					cwd="/repo"
					metadata={{ version: "0.0.1" }}
					updates={null}
					markUpdatesSeen={() => Promise.resolve()}
					unchained={false}
					transport={shellTransport}
					inputHistory={shellInputHistory}
					bootSkills={[]}
					modelConnectionTest={async () => ({ valid: false })}
					syntheticQuotaFetch={async () => ({ quota: null })}
				/>,
			);
			useAppStore.setState({
				cancelNotifyReadyForInput: () => {
					calls.push("second");
				},
			});

			await Bun.sleep(1);
			instance.stdin.write("x");
			await Bun.sleep(1);

			expect(calls).toEqual(["second"]);
			instance.unmount();
		} finally {
			globalThis.fetch = originalFetch;
			useAppStore.setState(previousState);
		}
	});

	it("keeps App shell selector stable when mode payload changes without changing derived shell state", () => {
		const previousModeData = useAppStore.getState().modeData;
		useAppStore.setState({
			modeData: { mode: "input", vimMode: "INSERT" },
			history: [],
			clearNonce: 0,
		});

		try {
			const before = selectAppShellState(useAppStore.getState());
			useAppStore.setState({
				modeData: { mode: "input", vimMode: "INSERT" },
			});
			const after = selectAppShellState(useAppStore.getState());

			expect(shallow(before, after)).toBe(true);
		} finally {
			useAppStore.setState({ modeData: previousModeData });
		}
	});
});
