import { describe, expect, it } from "bun:test";
import type { Config } from "../../../src/runtime/config/schemas";
import { runTool } from "../../../src/runtime/tools/main";
import type { Transport } from "../../../src/runtime/workspace/common";

const baseConfig: Config = {
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

function transport(overrides: Partial<Transport> = {}): Transport {
	return {
		cwd: "/repo",
		writeFile: async () => undefined,
		readFile: async () => "",
		pathExists: async () => true,
		isDirectory: async () => true,
		mkdir: async () => undefined,
		readdir: async () => [],
		modTime: async () => 0,
		resolvePath: async (_signal, filePath) => filePath,
		shell: async () => "",
		close: async () => undefined,
		...overrides,
	};
}

describe("tool orchestration LSP delegation", () => {
	it("runs lsp tool calls through tool run hook with detected server config", async () => {
		const fakeTransport = transport({
			resolvePath: async (_signal, filePath) => `/repo/${filePath}`,
			readFile: async (_signal, filePath) => `content:${filePath}`,
		});
		const runnerCalls: unknown[] = [];
		const tools = {
			"lsp-definition": {
				name: "lsp-definition",
				run: async () => {
					await Promise.resolve();
					return Promise.reject(
						new Error("fallback LSP runner should not run"),
					);
				},
			},
		} as never;
		const toolRun = async (params: unknown) => {
			await Promise.resolve();
			runnerCalls.push(params);
			return {
				status: "completed" as const,
				result: {
					type: "output" as const,
					content: [{ type: "text" as const, content: "lsp output" }],
				},
			};
		};

		const result = await runTool({
			abortSignal: new AbortController().signal,
			transport: fakeTransport,
			loaded: tools,
			call: {
				type: "tool-call",
				toolCallId: "lsp-1",
				name: "lsp-definition",
				original: { filePath: "src/main.ts", line: 7, character: 3 },
				parsed: { filePath: "src/main.ts", line: 7, character: 3 },
			},
			config: {
				...baseConfig,
				lsp: {
					testserver: {
						command: ["sh", "-c", "fake-lsp"],
						extensions: [".ts"],
						rootCandidates: [],
					},
				},
			},
			toolRun: toolRun,
		});

		expect(result.success).toBe(true);
		expect(runnerCalls).toEqual([
			{
				toolName: "lsp-definition",
				cwd: "/repo",
				toolCallId: "lsp-1",
				toolCall: {
					type: "tool-call",
					toolCallId: "lsp-1",
					name: "lsp-definition",
					original: { filePath: "src/main.ts", line: 7, character: 3 },
					parsed: { filePath: "src/main.ts", line: 7, character: 3 },
				},
				parsed: {
					filePath: "src/main.ts",
					line: 7,
					character: 3,
				},
				lsp: {
					testserver: {
						command: ["sh", "-c", "fake-lsp"],
						extensions: [".ts"],
						rootCandidates: [],
					},
				},
				modelContext: 200,
			},
		]);
	});
});
