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

function transport(): Transport {
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
	};
}

describe("MCP tool orchestration", () => {
	it("runs mcp tool calls through tool run hook with server config", async () => {
		const fakeTransport = transport();
		const runnerCalls: unknown[] = [];
		const tools = {
			mcp: {
				name: "mcp",
				run: async () => {
					await Promise.resolve();
					return Promise.reject(
						new Error("fallback MCP runner should not run"),
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
					content: [{ type: "text" as const, content: "mcp output" }],
				},
			};
		};

		const result = await runTool({
			abortSignal: new AbortController().signal,
			transport: fakeTransport,
			loaded: tools,
			call: {
				type: "tool-call",
				toolCallId: "mcp-1",
				name: "mcp",
				original: {
					server: "filesystem",
					tool: "read_file",
					arguments: { path: "README.md" },
				},
				parsed: {
					server: "filesystem",
					tool: "read_file",
					arguments: { path: "README.md" },
				},
			},
			config: {
				...baseConfig,
				mcpServers: {
					filesystem: {
						command: "server",
						args: ["--stdio"],
						env: { TOKEN: "abc" },
					},
				},
			},
			toolRun: toolRun,
		});

		expect(result.success).toBe(true);
		expect(runnerCalls).toEqual([
			{
				toolName: "mcp",
				cwd: "/repo",
				toolCallId: "mcp-1",
				toolCall: {
					type: "tool-call",
					toolCallId: "mcp-1",
					name: "mcp",
					original: {
						server: "filesystem",
						tool: "read_file",
						arguments: { path: "README.md" },
					},
					parsed: {
						server: "filesystem",
						tool: "read_file",
						arguments: { path: "README.md" },
					},
				},
				parsed: {
					server: "filesystem",
					tool: "read_file",
					arguments: { path: "README.md" },
				},
				mcpServers: {
					filesystem: {
						command: "server",
						args: ["--stdio"],
						env: { TOKEN: "abc" },
					},
				},
				modelContext: 200,
			},
		]);
	});
});
