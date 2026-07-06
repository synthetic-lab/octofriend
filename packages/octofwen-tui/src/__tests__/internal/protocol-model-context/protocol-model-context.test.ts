import { expect, test } from "bun:test";
import type { Config } from "../../../internal/configuration/schemas.ts";
import { loadTools } from "../../../internal/tool-orchestration/main.ts";
import type { Transport } from "../../../internal/transport/common.ts";

const transport: Transport = {
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

const baseConfig: Config = {
	yourName: "Octo",
	models: [
		{
			nickname: "main",
			baseUrl: "https://api.openai.com/v1",
			model: "gpt-4o",
			context: 100,
		},
	],
};

test("MCP tool declaration availability is requested from runtime definitions", async () => {
	const calls: unknown[] = [];
	await loadTools(
		transport,
		new AbortController().signal,
		{
			...baseConfig,
			mcpServers: {
				filesystem: { command: "mcp-server", args: ["--stdio"] },
			},
		},
		{
			toolDefinitions: async (params) => {
				await Promise.resolve();
				calls.push(params);
				return {
					tools: [
						{ name: "mcp", description: "MCP tools", argumentsSchema: {} },
					],
				};
			},
		},
	);

	expect(calls).toEqual([
		{ hasMcpServers: true, hasWebSearch: false, skills: [] },
	]);
});
