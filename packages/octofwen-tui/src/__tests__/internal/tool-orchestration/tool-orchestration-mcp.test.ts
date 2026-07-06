import { describe, expect, it } from "bun:test";
import type { Config } from "../../../internal/configuration/schemas.ts";
import { runTool } from "../../../internal/tool-orchestration/main.ts";
import type { Transport } from "../../../internal/transport/common.ts";

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
					throw new Error("fallback MCP runner should not run");
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

		const result = await runTool(
			new AbortController().signal,
			fakeTransport,
			tools,
			{
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
			{
				...baseConfig,
				mcpServers: {
					filesystem: {
						command: "server",
						args: ["--stdio"],
						env: { TOKEN: "abc" },
					},
				},
			},
			toolRun,
		);

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
