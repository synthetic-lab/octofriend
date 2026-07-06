import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import {
	ToolRequestRenderer,
	ToolRequestsRenderer,
} from "../../app/tool_requests.tsx";
import type { Config } from "../../internal/configuration/schemas.ts";
import type { Transport } from "../../internal/transport/common.ts";

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

	it("preflights rewrite contents before rendering and permission lookup", async () => {
		const permissionCalls: unknown[] = [];
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
				transport={transport()}
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

		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(lastFrame()).toContain("fresh file contents");
		expect(lastFrame()).not.toContain("stale file contents");
		expect(permissionCalls).toEqual([
			{
				toolName: "rewrite",
				parsed: {
					filePath: "rewrite.txt",
					text: "new file contents",
					originalFileContents: "fresh file contents with old text",
				},
			},
		]);
	});
});
