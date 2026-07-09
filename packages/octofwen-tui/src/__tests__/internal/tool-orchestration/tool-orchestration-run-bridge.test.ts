import { describe, expect, it } from "bun:test";
import type { Config } from "../../../internal/configuration/schemas.ts";
import {
	runTool,
	validateTool,
} from "../../../internal/tool-orchestration/main.ts";
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

function echoCommand(value: string): string[] {
	return [process.execPath, "--eval", `console.log(${JSON.stringify(value)})`];
}

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

describe("tool orchestration bridge runs", () => {
	it("runs fetch tool calls through tool run hook with model context", async () => {
		const fakeTransport = transport();
		const runnerCalls: unknown[] = [];
		const tools = {
			fetch: {
				name: "fetch",
				validate: async () => ({ success: true, data: null }),
				run: async () => {
					await Promise.resolve();
					return Promise.reject(
						new Error("fallback fetch runner should not run"),
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
					content: [{ type: "text" as const, content: "Hello" }],
				},
			};
		};

		const result = await runTool({
			abortSignal: new AbortController().signal,
			transport: fakeTransport,
			loaded: tools,
			call: {
				type: "tool-call",
				toolCallId: "fetch-1",
				name: "fetch",
				original: { url: "https://example.com" },
				parsed: { url: "https://example.com" },
			},
			config: baseConfig,
			toolRun: toolRun,
		});

		expect(result.success).toBe(true);
		expect(runnerCalls).toEqual([
			{
				toolName: "fetch",
				cwd: "/repo",
				toolCallId: "fetch-1",
				toolCall: {
					type: "tool-call",
					toolCallId: "fetch-1",
					name: "fetch",
					original: { url: "https://example.com" },
					parsed: { url: "https://example.com" },
				},
				parsed: { url: "https://example.com" },
				modelContext: 200,
			},
		]);
	});

	it("runs web-search tool calls through tool run hook with resolved search config", async () => {
		const fakeTransport = transport();
		const runnerCalls: unknown[] = [];
		const config: Config = {
			...baseConfig,
			search: {
				url: "https://search.example/query",
				auth: { type: "command", command: echoCommand("search-key") },
			},
		};
		const tools = {
			"web-search": {
				name: "web-search",
				validate: async () => ({ success: true, data: null }),
				run: async () => {
					await Promise.resolve();
					return Promise.reject(
						new Error("fallback web-search runner should not run"),
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
					content: [{ type: "text" as const, content: "{}" }],
				},
			};
		};

		const result = await runTool({
			abortSignal: new AbortController().signal,
			transport: fakeTransport,
			loaded: tools,
			call: {
				type: "tool-call",
				toolCallId: "search-1",
				name: "web-search",
				original: { query: "octofwen" },
				parsed: { query: "octofwen" },
			},
			config: config,
			toolRun: toolRun,
		});

		expect(result.success).toBe(true);
		expect(runnerCalls).toEqual([
			{
				toolName: "web-search",
				cwd: "/repo",
				toolCallId: "search-1",
				toolCall: {
					type: "tool-call",
					toolCallId: "search-1",
					name: "web-search",
					original: { query: "octofwen" },
					parsed: { query: "octofwen" },
				},
				parsed: {
					query: "octofwen",
				},
				modelContext: 200,
				webSearch: {
					searchUrl: "https://search.example/query",
					searchKey: "search-key",
				},
			},
		]);
	});

	it("runs skill tool calls through tool run hook with discovered skills", async () => {
		const fakeTransport = transport();
		const runnerCalls: unknown[] = [];
		const tools = {
			skill: {
				name: "skill",
				validate: async () => ({ success: true, data: null }),
				run: async () => {
					await Promise.resolve();
					return Promise.reject(
						new Error("fallback skill runner should not run"),
					);
				},
				extra: {
					skills: [
						{
							name: "review-code",
							description: "Reviews source changes.",
							instructions: "Inspect the diff before commenting.",
							path: "/skills/review-code",
							skillFilePath: "/skills/review-code/SKILL.md",
						},
					],
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
					content: [
						{ type: "text" as const, content: "Skill name: review-code" },
					],
				},
			};
		};

		const result = await runTool({
			abortSignal: new AbortController().signal,
			transport: fakeTransport,
			loaded: tools,
			call: {
				type: "tool-call",
				toolCallId: "skill-1",
				name: "skill",
				original: { skillName: "review-code" },
				parsed: { skillName: "review-code" },
			},
			config: baseConfig,
			toolRun: toolRun,
		});

		expect(result.success).toBe(true);
		expect(runnerCalls).toEqual([
			{
				toolName: "skill",
				cwd: "/repo",
				toolCallId: "skill-1",
				toolCall: {
					type: "tool-call",
					toolCallId: "skill-1",
					name: "skill",
					original: { skillName: "review-code" },
					parsed: { skillName: "review-code" },
				},
				parsed: {
					skillName: "review-code",
				},
				modelContext: 200,
				userName: "Octo",
				skills: [
					{
						name: "review-code",
						description: "Reviews source changes.",
						instructions: "Inspect the diff before commenting.",
						path: "/skills/review-code",
						skillFilePath: "/skills/review-code/SKILL.md",
					},
				],
			},
		]);
	});

	it("returns Result errors for aborted and rejected bridge calls", async () => {
		const aborted = new AbortController();
		aborted.abort();
		const tools = { read: { name: "read" } } as never;
		const call = {
			type: "tool-call",
			toolCallId: "read-1",
			name: "read",
			original: {},
			parsed: {},
		} as never;

		const abortResult = await runTool({
			abortSignal: aborted.signal,
			transport: transport(),
			loaded: tools,
			call: call,
			config: baseConfig,
			toolRun: async () => ({
				status: "completed",
				result: { type: "output", content: [] },
			}),
		});
		const rejectResult = await runTool({
			abortSignal: new AbortController().signal,
			transport: transport(),
			loaded: tools,
			call: call,
			config: baseConfig,
			toolRun: async () => {
				await Promise.resolve();
				return Promise.reject(new Error("bridge down"));
			},
		});

		expect(abortResult.success).toBe(false);
		expect(rejectResult.success).toBe(false);
		if (!abortResult.success)
			expect(abortResult.error).toBe("Tool run aborted");
		if (!rejectResult.success) expect(rejectResult.error).toBe("bridge down");
	});

	it("validates loaded tool calls through tool validation and reports unknown tools", async () => {
		const fakeTransport = transport();
		const validatorCalls: unknown[] = [];
		const tools = {
			list: {
				name: "list",
				run: async () => ({
					success: true,
					data: { type: "output", content: [] },
				}),
				validate: async () => {
					await Promise.resolve();
					return Promise.reject(
						new Error("fallback tool validator should not run"),
					);
				},
			},
		} as never;
		const toolValidate = async (params: unknown) => {
			await Promise.resolve();
			validatorCalls.push(params);
			return { status: "valid" as const };
		};

		const valid = await validateTool(
			new AbortController().signal,
			fakeTransport,
			tools,
			{
				type: "tool-call",
				toolCallId: "list-1",
				name: "list",
				original: { dirPath: "src" },
				parsed: { dirPath: "src" },
			},
			toolValidate,
		);
		const invalid = await validateTool(
			new AbortController().signal,
			fakeTransport,
			tools,
			{
				type: "tool-call",
				toolCallId: "missing-1",
				name: "missing",
				original: {},
				parsed: {},
			} as never,
			toolValidate,
		);

		expect(valid.success).toBe(true);
		expect(validatorCalls).toEqual([
			{ toolName: "list", cwd: "/repo", parsed: { dirPath: "src" } },
		]);
		expect(invalid.success).toBe(false);
		if (!invalid.success) expect(invalid.error).toBe("No tool named missing");
	});
});
