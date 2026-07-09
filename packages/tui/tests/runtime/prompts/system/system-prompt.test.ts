import { describe, expect, it } from "bun:test";
import type { Config } from "../../../../src/runtime/config/schemas";
import { systemPrompt } from "../../../../src/runtime/prompts/system/main";
import type { Transport } from "../../../../src/runtime/workspace/common";

function memoryTransport(cwd: string): Transport {
	return {
		cwd,
		writeFile() {
			return Promise.reject(new Error("unexpected writeFile"));
		},
		readFile() {
			return Promise.reject(new Error("unexpected readFile"));
		},
		pathExists() {
			return Promise.reject(new Error("unexpected pathExists"));
		},
		isDirectory() {
			return Promise.reject(new Error("unexpected isDirectory"));
		},
		mkdir() {
			return Promise.reject(new Error("unexpected mkdir"));
		},
		readdir() {
			return Promise.reject(new Error("unexpected readdir"));
		},
		modTime() {
			return Promise.reject(new Error("unexpected modTime"));
		},
		resolvePath() {
			return Promise.reject(new Error("unexpected resolvePath"));
		},
		shell() {
			return Promise.reject(new Error("unexpected shell"));
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
