import { expect, test } from "bun:test";
import type { Config } from "../../../src/runtime/config/schemas.ts";
import { loadTools } from "../../../src/runtime/tools/main.ts";
import type { Transport } from "../../../src/runtime/workspace/common.ts";
import type { Result } from "../../../src/shell/result.ts";

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

function expectOk<T, E>(result: Result<T, E>): T {
	if (result.success) return result.data;
	throw new Error(String(result.error));
}

const baseConfig: Config = {
	yourName: "Octo",
	defaultApiKeyOverrides: { synthetic: "MISSING_SYNTHETIC_TEST_KEY" },
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
	expectOk(
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
		),
	);

	expect(calls).toEqual([
		{ hasMcpServers: true, hasWebSearch: false, skills: [] },
	]);
});
