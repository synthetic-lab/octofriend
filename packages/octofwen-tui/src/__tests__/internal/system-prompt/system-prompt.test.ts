import { describe, expect, it } from "bun:test";
import type { Config } from "../../../internal/configuration/schemas.ts";
import { systemPrompt } from "../../../internal/system-prompt/main.ts";
import type { Transport } from "../../../internal/transport/common.ts";

function memoryTransport(cwd: string): Transport {
	return {
		cwd,
		writeFile() {
			throw new Error("unexpected writeFile");
		},
		readFile() {
			throw new Error("unexpected readFile");
		},
		pathExists() {
			throw new Error("unexpected pathExists");
		},
		isDirectory() {
			throw new Error("unexpected isDirectory");
		},
		mkdir() {
			throw new Error("unexpected mkdir");
		},
		readdir() {
			throw new Error("unexpected readdir");
		},
		modTime() {
			throw new Error("unexpected modTime");
		},
		resolvePath() {
			throw new Error("unexpected resolvePath");
		},
		shell() {
			throw new Error("unexpected shell");
		},
		close() {
			return Promise.resolve();
		},
	};
}

describe("system prompt", () => {
	it("delegates directory and instruction discovery to the prompt builder", async () => {
		const seenBuildParams: unknown[] = [];
		const prompt = await systemPrompt({
			config: { yourName: "Krystian", mcpServers: {} } as Config,
			transport: memoryTransport("/home/krystian/project"),
			signal: new AbortController().signal,
			systemPromptBuild: (params) => {
				seenBuildParams.push(params);
				return Promise.resolve({ prompt: `user=${params.userName}` });
			},
		});

		expect(seenBuildParams).toEqual([
			{
				userName: "Krystian",
				workingDirectory: "/home/krystian/project",
				mcpPrompt: "",
			},
		]);
		expect(prompt).toBe("user=Krystian");
	});
});
