import { afterEach, describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import { useAppStore } from "../../src/shell/state/store";
import { ToolRequestPrompt } from "../../src/shell/tool-options";
import {
	selectIsRunningToolCall,
	TOOL_REQUEST_PREPARE_ERROR,
	ToolRequestRenderer,
	ToolRequestsRenderer,
} from "../../src/shell/tool-requests";
import type { Config } from "../../src/runtime/config/schemas";
import type { ToolCall as ToolCallRequest } from "../../src/runtime/tools/main";
import type { Transport } from "../../src/runtime/workspace/common";

const originalStoreActions = {
	runTool: useAppStore.getState().runTool,
	isWhitelisted: useAppStore.getState().isWhitelisted,
	notifyReadyForInput: useAppStore.getState().notifyReadyForInput,
};

afterEach(() => {
	useAppStore.setState({
		modeData: { mode: "input", vimMode: "INSERT" },
		whitelist: new Set<string>(),
		runTool: originalStoreActions.runTool,
		isWhitelisted: originalStoreActions.isWhitelisted,
		notifyReadyForInput: originalStoreActions.notifyReadyForInput,
	});
});

const config: Config = {
	yourName: "Octo",
	models: [
		{
			nickname: "main",
			baseUrl: "https://api.openai.com/v1",
			model: "gpt-4o",
			context: 200,
		},
	],
};

async function waitForCondition(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

function transport(overrides: Partial<Transport> = {}): Transport {
	return {
		cwd: "/repo",
		writeFile: async () => undefined,
		readFile: async () => "fresh file contents with old text",
		pathExists: async () => true,
		isDirectory: async () => false,
		mkdir: async () => undefined,
		readdir: async () => [],
		modTime: async () => 0,
		resolvePath: async (_signal, filePath) => filePath,
		shell: async () => "",
		close: async () => undefined,
		...overrides,
	};
}

describe("terminal tool request rendering", () => {
	it("exports the terminal tool request components", () => {
		expect(ToolRequestsRenderer).toBeFunction();
		expect(ToolRequestRenderer).toBeFunction();
	});

	it("selects only whether the current tool call is running", () => {
		const abortController = new AbortController();
		expect(
			selectIsRunningToolCall(
				{
					modeData: {
						mode: "tool-call",
						toolReqs: [],
						runningToolCallId: "call-1",
						abortController,
					},
				} as Parameters<typeof selectIsRunningToolCall>[0],
				"call-1",
			),
		).toBe(true);
		expect(
			selectIsRunningToolCall(
				{
					modeData: {
						mode: "tool-call",
						toolReqs: [],
						runningToolCallId: "call-2",
						abortController,
					},
				} as Parameters<typeof selectIsRunningToolCall>[0],
				"call-1",
			),
		).toBe(false);
	});

	it("normalizes tool request prompt file path line breaks before rendering", () => {
		const { lastFrame } = render(
			<ToolRequestPrompt
				configColor="cyan"
				toolReq={{
					type: "tool-call",
					toolCallId: "create-cr-path",
					name: "create",
					parsed: { filePath: "src\r\nnew\rfile.ts" },
					original: {},
				}}
			/>,
		);

		const frame = lastFrame() ?? "";
		expect(frame).toContain("src");
		expect(frame).toContain("new");
		expect(frame).toContain("file.ts");
		expect(frame).not.toContain("\r");
	});

	it("preflights rewrite contents once before rendering and permission lookup", async () => {
		const permissionCalls: unknown[] = [];
		let readCalls = 0;
		const { lastFrame } = render(
			<ToolRequestsRenderer
				toolReqs={[
					{
						type: "tool-call",
						toolCallId: "rewrite-1",
						name: "rewrite",
						original: { filePath: "rewrite.txt", text: "new file contents" },
						parsed: {
							filePath: "rewrite.txt",
							text: "new file contents",
							originalFileContents: "stale file contents",
						},
					},
				]}
				config={config}
				transport={transport({
					readFile: () => {
						readCalls += 1;
						return Promise.resolve("fresh file contents with old text");
					},
				})}
				toolPermission={async (params) => {
					await Promise.resolve();
					permissionCalls.push(params);
					return {
						whitelistKey: "rewrite:rewrite.txt",
						skipConfirmation: false,
						alwaysRequestPermission: false,
					};
				}}
				toolDefinitions={async () => ({ tools: [] })}
				toolRun={async () => ({
					status: "completed",
					result: { type: "output", content: [] },
				})}
			/>,
		);

		await waitForCondition(
			() =>
				(lastFrame() || "").includes("fresh file contents") &&
				permissionCalls.length === 1,
		);
		expect(lastFrame()).toContain("fresh file contents");
		expect(lastFrame()).not.toContain("stale file contents");
		expect(readCalls).toBe(1);
		expect(permissionCalls).toEqual([
			{
				toolName: "rewrite",
				cwd: "/repo",
				parsed: {
					filePath: "rewrite.txt",
					text: "new file contents",
					originalFileContents: "fresh file contents with old text",
				},
			},
		]);
	});

	it("does not auto-run a new tool from a stale whitelist check", async () => {
		const runCalls: string[] = [];
		const releaseNewWhitelistCheck: { current: (() => void) | null } = {
			current: null,
		};
		const oldToolReq: ToolCallRequest = {
			type: "tool-call",
			toolCallId: "old-call",
			name: "old-tool",
			parsed: {},
			original: {},
		};
		const newToolReq: ToolCallRequest = {
			type: "tool-call",
			toolCallId: "new-call",
			name: "new-tool",
			parsed: {},
			original: {},
		};

		useAppStore.setState({
			runTool: ({ toolReq }) => {
				runCalls.push(toolReq.toolCallId);
				return Promise.resolve();
			},
			isWhitelisted: async (whitelistKey) => {
				if (whitelistKey === "old-tool-key") return true;
				await new Promise<void>((resolve) => {
					releaseNewWhitelistCheck.current = resolve;
				});
				return false;
			},
			notifyReadyForInput: () => undefined,
		});

		const toolPermission = async ({ toolName }: { toolName: string }) => ({
			whitelistKey: `${toolName}-key`,
			skipConfirmation: false,
			alwaysRequestPermission: false,
		});
		const toolRun = async () => ({
			status: "completed" as const,
			result: { type: "output" as const, content: [] },
		});
		const toolDefinitions = async () => ({ tools: [] });
		const onDone = () => undefined;

		const rendered = render(
			<ToolRequestRenderer
				toolReq={oldToolReq}
				preflighted={true}
				config={config}
				transport={transport()}
				toolPermission={toolPermission}
				toolDefinitions={toolDefinitions}
				toolRun={toolRun}
				onDone={onDone}
			/>,
		);

		await waitForCondition(() => runCalls.includes("old-call"));
		const oldRunCount = runCalls.length;
		rendered.rerender(
			<ToolRequestRenderer
				toolReq={newToolReq}
				preflighted={true}
				config={config}
				transport={transport()}
				toolPermission={toolPermission}
				toolDefinitions={toolDefinitions}
				toolRun={toolRun}
				onDone={onDone}
			/>,
		);

		await waitForCondition(() => releaseNewWhitelistCheck.current !== null);
		await Promise.resolve();
		expect(runCalls.slice(oldRunCount)).not.toContain("new-call");

		const releaseWhitelistCheck = releaseNewWhitelistCheck.current;
		if (releaseWhitelistCheck == null)
			throw new Error("missing whitelist release");
		releaseWhitelistCheck();
		await waitForCondition(
			() => rendered.lastFrame()?.includes("Yes") ?? false,
		);
		expect(runCalls).not.toContain("new-call");
	});

	it("runs a confirmed tool only once across duplicate submits", async () => {
		const runCalls: string[] = [];
		let doneCount = 0;
		const releaseRun: { current: () => void } = {
			current: () => {
				throw new Error("missing run release");
			},
		};
		const toolReq: ToolCallRequest = {
			type: "tool-call",
			toolCallId: "manual-call",
			name: "manual-tool",
			parsed: {},
			original: {},
		};

		useAppStore.setState({
			runTool: ({ toolReq }) => {
				runCalls.push(toolReq.toolCallId);
				return new Promise<void>((resolve) => {
					releaseRun.current = resolve;
				});
			},
			isWhitelisted: async () => false,
			notifyReadyForInput: () => undefined,
		});

		const rendered = render(
			<ToolRequestRenderer
				toolReq={toolReq}
				preflighted={true}
				config={config}
				transport={transport()}
				toolPermission={async () => ({
					whitelistKey: "manual-tool-key",
					skipConfirmation: false,
					alwaysRequestPermission: false,
				})}
				toolDefinitions={async () => ({ tools: [] })}
				toolRun={async () => ({
					status: "completed",
					result: { type: "output", content: [] },
				})}
				onDone={() => {
					doneCount += 1;
				}}
			/>,
		);

		await waitForCondition(() => (rendered.lastFrame() ?? "").includes("Yes"));
		rendered.stdin.write("\r");
		await waitForCondition(() => runCalls.length === 1);
		rendered.stdin.write("\r");
		await Bun.sleep(1);

		expect(runCalls).toEqual(["manual-call"]);
		expect(doneCount).toBe(0);
		releaseRun.current();
		await waitForCondition(() => doneCount === 1);
		expect(runCalls).toEqual(["manual-call"]);
	});

	it("auto-runs a skip-confirmation tool only once across callback churn", async () => {
		const runCalls: string[] = [];
		const onDoneCalls: string[] = [];
		const toolReq: ToolCallRequest = {
			type: "tool-call",
			toolCallId: "skip-call",
			name: "skip-tool",
			parsed: {},
			original: {},
		};

		useAppStore.setState({
			runTool: ({ toolReq }) => {
				runCalls.push(toolReq.toolCallId);
				return Promise.resolve();
			},
			isWhitelisted: async () => false,
			notifyReadyForInput: () => undefined,
		});

		const toolPermission = async () => ({
			whitelistKey: "skip-tool-key",
			skipConfirmation: true,
			alwaysRequestPermission: false,
		});
		const toolRun = async () => ({
			status: "completed" as const,
			result: { type: "output" as const, content: [] },
		});
		const toolDefinitions = async () => ({ tools: [] });

		const rendered = render(
			<ToolRequestRenderer
				toolReq={toolReq}
				preflighted={true}
				config={config}
				transport={transport()}
				toolPermission={toolPermission}
				toolDefinitions={toolDefinitions}
				toolRun={toolRun}
				onDone={() => onDoneCalls.push("first")}
			/>,
		);

		await waitForCondition(() => runCalls.length === 1);
		rendered.rerender(
			<ToolRequestRenderer
				toolReq={toolReq}
				preflighted={true}
				config={{ ...config }}
				transport={transport()}
				toolPermission={toolPermission}
				toolDefinitions={toolDefinitions}
				toolRun={toolRun}
				onDone={() => onDoneCalls.push("second")}
			/>,
		);
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(runCalls).toEqual(["skip-call"]);
		expect(onDoneCalls).toEqual(["first"]);
	});

	it("shows a stable tool request error when permission lookup rejects", async () => {
		const { lastFrame } = render(
			<ToolRequestRenderer
				toolReq={{
					type: "tool-call",
					toolCallId: "broken-call",
					name: "broken-tool",
					parsed: {},
					original: {},
				}}
				preflighted={true}
				config={config}
				transport={transport()}
				toolPermission={() =>
					Promise.reject(new Error("secret raw bridge failure"))
				}
				toolDefinitions={async () => ({ tools: [] })}
				toolRun={async () => ({
					status: "completed",
					result: { type: "output", content: [] },
				})}
				onDone={() => undefined}
			/>,
		);

		await waitForCondition(() =>
			(lastFrame() || "").includes(TOOL_REQUEST_PREPARE_ERROR),
		);
		expect(lastFrame()).toContain(TOOL_REQUEST_PREPARE_ERROR);
		expect(lastFrame()).not.toContain("secret raw bridge failure");
	});
});
