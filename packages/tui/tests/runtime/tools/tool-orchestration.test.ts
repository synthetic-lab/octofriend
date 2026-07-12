import { describe, expect, it } from "bun:test";
import type { Config } from "../../../src/runtime/config/schemas.ts";
import {
	loadTools,
	preflightToolCall,
	runTool,
} from "../../../src/runtime/tools/main.ts";
import type { Transport } from "../../../src/runtime/workspace/common.ts";
import type { Result } from "../../../src/shell/result.ts";

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

const baseToolDefinitions = async ({
	skills,
}: {
	skills: Array<{ name: string }>;
}) => ({
	tools: [
		{ name: "read", description: "Read files", argumentsSchema: {} },
		{ name: "shell", description: "Run shell commands", argumentsSchema: {} },
		{ name: "list", description: "List files", argumentsSchema: {} },
		...(skills.length > 0
			? [
					{
						name: "skill",
						description: "Skill review-code",
						argumentsSchema: {},
					},
				]
			: []),
	],
});

function expectOk<T, E>(result: Result<T, E>): T {
	if (result.success) return result.data;
	throw new Error(String(result.error));
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

describe("tool orchestration", () => {
	it("loads available built-in tools and skips unavailable dynamic tools", async () => {
		const tools = expectOk(
			await loadTools(transport(), new AbortController().signal, baseConfig, {
				toolDefinitions: baseToolDefinitions,
			}),
		);

		expect(tools["read"]?.name).toBe("read");
		expect(tools["shell"]?.name).toBe("shell");
		expect(tools["list"]?.name).toBe("list");
		expect(tools["skill"]).toBeUndefined();
		expect(tools["web-search"]).toBeUndefined();
	});

	it("stops loading tools when the request is aborted", async () => {
		const controller = new AbortController();
		const definitionsCalls: unknown[] = [];
		const result = await loadTools(transport(), controller.signal, baseConfig, {
			skillDiscover: async () => {
				await Promise.resolve();
				controller.abort();
				return { skills: [] };
			},
			toolDefinitions: async (params) => {
				await Promise.resolve();
				definitionsCalls.push(params);
				return { tools: [] };
			},
		});

		expect(result.success).toBe(false);
		if (!result.success) expect(result.error).toBe("Tool load aborted");
		expect(definitionsCalls).toEqual([]);
	});

	it("loads the skill tool from discovered skills", async () => {
		const tools = expectOk(
			await loadTools(
				transport({
					readFile: async () => {
						await Promise.resolve();
						return Promise.reject(
							new Error("TypeScript skill discovery should not read files"),
						);
					},
					readdir: async () => {
						await Promise.resolve();
						return Promise.reject(
							new Error("TypeScript skill discovery should not read dirs"),
						);
					},
					pathExists: async () => {
						await Promise.resolve();
						return Promise.reject(
							new Error("TypeScript skill discovery should not stat paths"),
						);
					},
				}),
				new AbortController().signal,
				baseConfig,
				{
					toolDefinitions: baseToolDefinitions,
					skillDiscover: async () => ({
						skills: [
							{
								name: "review-code",
								description: "Reviews source changes.",
								instructions: "Inspect the diff before commenting.",
								path: "/skills/review-code",
								skillFilePath: "/skills/review-code/SKILL.md",
								metadata: {},
							},
						],
					}),
				},
			),
		);

		expect(tools["skill"]?.name).toBe("skill");
		expect(
			(tools["skill"] as { extra?: { skills?: unknown[] } } | undefined)?.extra
				?.skills,
		).toEqual([
			{
				name: "review-code",
				description: "Reviews source changes.",
				instructions: "Inspect the diff before commenting.",
				path: "/skills/review-code",
				skillFilePath: "/skills/review-code/SKILL.md",
				metadata: {},
			},
		]);
		expect(tools["skill"]?.description).toContain("review-code");
	});
	it("requires tool run hook for every loaded tool call", async () => {
		const result = await runTool({
			abortSignal: new AbortController().signal,
			transport: transport(),
			loaded: { "custom-tool": { name: "custom-tool" } } as never,
			call: {
				type: "tool-call",
				toolCallId: "custom-1",
				name: "custom-tool",
				original: { value: "input" },
				parsed: { value: "input" },
			} as never,
			config: baseConfig,
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe("Tool runner is required for custom-tool");
		}
	});

	it("requires tool run hook for agentd deterministic tool calls", async () => {
		const fakeTransport = transport();
		const tools = {
			shell: {
				name: "shell",
				run: async () => {
					await Promise.resolve();
					return Promise.reject(
						new Error("fallback shell runner should not run"),
					);
				},
			},
		} as never;

		const result = await runTool({
			abortSignal: new AbortController().signal,
			transport: fakeTransport,
			loaded: tools,
			call: {
				type: "tool-call",
				toolCallId: "shell-1",
				name: "shell",
				original: { cmd: "pwd", timeout: 1000 },
				parsed: { cmd: "pwd", timeout: 1000 },
			},
			config: baseConfig,
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe("Tool runner is required for shell");
		}
	});

	it("runs agentd deterministic tool calls through tool run hook", async () => {
		const fakeTransport = transport();
		const runnerCalls: unknown[] = [];
		const tools = {
			read: {
				name: "read",
				validate: async () => ({ success: true, data: null }),
				run: async () => {
					await Promise.resolve();
					return Promise.reject(
						new Error("fallback tool runner should not run"),
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
					type: "custom-ir" as const,
					data: {
						role: "file-read",
						content: "1: alpha",
						path: "read.txt",
						toolCall: {
							type: "tool-call",
							toolCallId: "read-1",
							name: "read",
							original: { filePath: "read.txt" },
							parsed: { filePath: "read.txt" },
						},
					},
				},
			};
		};

		const result = await runTool({
			abortSignal: new AbortController().signal,
			transport: fakeTransport,
			loaded: tools,
			call: {
				type: "tool-call",
				toolCallId: "read-1",
				name: "read",
				original: { filePath: "read.txt" },
				parsed: { filePath: "read.txt" },
			},
			config: baseConfig,
			toolRun: toolRun,
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual({
				type: "custom-ir",
				data: {
					role: "file-read",
					content: "1: alpha",
					path: "read.txt",
					toolCall: {
						type: "tool-call",
						toolCallId: "read-1",
						name: "read",
						original: { filePath: "read.txt" },
						parsed: { filePath: "read.txt" },
					},
				},
			});
		}
		expect(runnerCalls).toEqual([
			{
				toolName: "read",
				cwd: "/repo",
				toolCallId: "read-1",
				toolCall: {
					type: "tool-call",
					toolCallId: "read-1",
					name: "read",
					original: { filePath: "read.txt" },
					parsed: { filePath: "read.txt" },
				},
				parsed: { filePath: "read.txt" },
				modelContext: 200,
			},
		]);
	});

	it("preflights edit and rewrite contents from the transport at run time", async () => {
		const signal = new AbortController().signal;
		const reads: string[] = [];
		const fakeTransport = transport({
			readFile: async (_signal, filePath) => {
				await Promise.resolve();
				reads.push(filePath);
				return filePath === "edit.txt"
					? "fresh edit contents"
					: "fresh rewrite contents";
			},
		});

		const preflight = await preflightToolCall(signal, fakeTransport, {
			type: "tool-call",
			toolCallId: "edit-1",
			name: "edit",
			original: { filePath: "edit.txt", search: "old", replace: "new" },
			parsed: {
				filePath: "edit.txt",
				search: "old",
				replace: "new",
				originalFileContents: "stale",
			},
		});
		const preflightData = expectOk(preflight);
		expect(preflightData).toEqual({
			type: "tool-call",
			toolCallId: "edit-1",
			name: "edit",
			original: { filePath: "edit.txt", search: "old", replace: "new" },
			parsed: {
				filePath: "edit.txt",
				search: "old",
				replace: "new",
				originalFileContents: "fresh edit contents",
			},
		});
		expect(reads).toEqual(["edit.txt"]);
	});

	it("runs agentd deterministic tool calls with preflighted file contents", async () => {
		const fakeTransport = transport({
			readFile: async (_signal, filePath) =>
				filePath === "rewrite.txt" ? "fresh file" : "",
		});
		const runnerCalls: unknown[] = [];
		const tools = {
			rewrite: {
				name: "rewrite",
				validate: async () => ({ success: true, data: null }),
				run: async () => {
					await Promise.resolve();
					return Promise.reject(
						new Error("fallback rewrite runner should not run"),
					);
				},
			},
		} as never;
		const toolRun = async (params: unknown) => {
			await Promise.resolve();
			runnerCalls.push(params);
			return {
				status: "completed" as const,
				result: { type: "output" as const, content: [] },
			};
		};

		const result = await runTool({
			abortSignal: new AbortController().signal,
			transport: fakeTransport,
			loaded: tools,
			call: {
				type: "tool-call",
				toolCallId: "rewrite-1",
				name: "rewrite",
				original: { filePath: "rewrite.txt", text: "replacement" },
				parsed: {
					filePath: "rewrite.txt",
					text: "replacement",
					originalFileContents: "stale",
				},
			},
			config: baseConfig,
			toolRun: toolRun,
		});

		expect(result.success).toBe(true);
		expect(runnerCalls).toEqual([
			{
				toolName: "rewrite",
				cwd: "/repo",
				toolCallId: "rewrite-1",
				toolCall: {
					type: "tool-call",
					toolCallId: "rewrite-1",
					name: "rewrite",
					original: { filePath: "rewrite.txt", text: "replacement" },
					parsed: {
						filePath: "rewrite.txt",
						text: "replacement",
						originalFileContents: "fresh file",
					},
				},
				parsed: {
					filePath: "rewrite.txt",
					text: "replacement",
					originalFileContents: "fresh file",
				},
				modelContext: 200,
			},
		]);
	});

	it("passes Docker transport context to agentd tool runs", async () => {
		const fakeTransport = transport({
			cwd: "/workspace",
			toolRunTransport: () => ({ type: "docker", container: "container-123" }),
		});
		const runnerCalls: unknown[] = [];
		const tools = {
			read: {
				name: "read",
				validate: async () => ({ success: true, data: null }),
				run: async () => {
					await Promise.resolve();
					return Promise.reject(
						new Error("fallback read runner should not run"),
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
					content: [{ type: "text" as const, content: "from docker" }],
				},
			};
		};

		const result = await runTool({
			abortSignal: new AbortController().signal,
			transport: fakeTransport,
			loaded: tools,
			call: {
				type: "tool-call",
				toolCallId: "read-docker-1",
				name: "read",
				original: { filePath: "README.md" },
				parsed: { filePath: "README.md" },
			},
			config: baseConfig,
			toolRun: toolRun,
		});

		expect(result.success).toBe(true);
		expect(runnerCalls).toEqual([
			{
				toolName: "read",
				cwd: "/workspace",
				transport: { type: "docker", container: "container-123" },
				toolCallId: "read-docker-1",
				toolCall: {
					type: "tool-call",
					toolCallId: "read-docker-1",
					name: "read",
					original: { filePath: "README.md" },
					parsed: { filePath: "README.md" },
				},
				parsed: { filePath: "README.md" },
				modelContext: 200,
			},
		]);
	});

	it("passes SSH transport context to agentd tool runs", async () => {
		const fakeTransport = transport({
			cwd: "/remote/workspace",
			toolRunTransport: () => ({ type: "ssh", target: "user@example.test" }),
		});
		const runnerCalls: unknown[] = [];
		const tools = {
			read: {
				name: "read",
				validate: async () => ({ success: true, data: null }),
				run: async () => {
					await Promise.resolve();
					return Promise.reject(
						new Error("fallback read runner should not run"),
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
					content: [{ type: "text" as const, content: "from ssh" }],
				},
			};
		};

		const result = await runTool({
			abortSignal: new AbortController().signal,
			transport: fakeTransport,
			loaded: tools,
			call: {
				type: "tool-call",
				toolCallId: "read-ssh-1",
				name: "read",
				original: { filePath: "README.md" },
				parsed: { filePath: "README.md" },
			},
			config: baseConfig,
			toolRun: toolRun,
		});

		expect(result.success).toBe(true);
		expect(runnerCalls).toEqual([
			{
				toolName: "read",
				cwd: "/remote/workspace",
				transport: { type: "ssh", target: "user@example.test" },
				toolCallId: "read-ssh-1",
				toolCall: {
					type: "tool-call",
					toolCallId: "read-ssh-1",
					name: "read",
					original: { filePath: "README.md" },
					parsed: { filePath: "README.md" },
				},
				parsed: { filePath: "README.md" },
				modelContext: 200,
			},
		]);
	});

	it("runs shell tool calls through tool run hook", async () => {
		const fakeTransport = transport();
		const runnerCalls: unknown[] = [];
		const tools = {
			shell: {
				name: "shell",
				validate: async () => ({ success: true, data: null }),
				run: async () => {
					await Promise.resolve();
					return Promise.reject(
						new Error("fallback shell runner should not run"),
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
					content: [{ type: "text" as const, content: "shell output" }],
				},
			};
		};

		const result = await runTool({
			abortSignal: new AbortController().signal,
			transport: fakeTransport,
			loaded: tools,
			call: {
				type: "tool-call",
				toolCallId: "shell-1",
				name: "shell",
				original: { cmd: "pwd", timeout: 1000 },
				parsed: { cmd: "pwd", timeout: 1000 },
			},
			config: baseConfig,
			toolRun: toolRun,
		});

		expect(result.success).toBe(true);
		expect(runnerCalls).toEqual([
			{
				toolName: "shell",
				cwd: "/repo",
				toolCallId: "shell-1",
				toolCall: {
					type: "tool-call",
					toolCallId: "shell-1",
					name: "shell",
					original: { cmd: "pwd", timeout: 1000 },
					parsed: { cmd: "pwd", timeout: 1000 },
				},
				parsed: { cmd: "pwd", timeout: 1000 },
				modelContext: 200,
			},
		]);
	});

	it("runs glob tool calls through tool run hook", async () => {
		const fakeTransport = transport();
		const runnerCalls: unknown[] = [];
		const tools = {
			glob: {
				name: "glob",
				validate: async () => ({ success: true, data: null }),
				run: async () => {
					await Promise.resolve();
					return Promise.reject(
						new Error("fallback glob runner should not run"),
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
					content: [{ type: "text" as const, content: "src/main.ts" }],
				},
			};
		};

		const result = await runTool({
			abortSignal: new AbortController().signal,
			transport: fakeTransport,
			loaded: tools,
			call: {
				type: "tool-call",
				toolCallId: "glob-1",
				name: "glob",
				original: { path: "src", includeName: "*.ts" },
				parsed: { path: "src", includeName: "*.ts" },
			},
			config: baseConfig,
			toolRun: toolRun,
		});

		expect(result.success).toBe(true);
		expect(runnerCalls).toEqual([
			{
				toolName: "glob",
				cwd: "/repo",
				toolCallId: "glob-1",
				toolCall: {
					type: "tool-call",
					toolCallId: "glob-1",
					name: "glob",
					original: { path: "src", includeName: "*.ts" },
					parsed: { path: "src", includeName: "*.ts" },
				},
				parsed: { path: "src", includeName: "*.ts" },
				modelContext: 200,
			},
		]);
	});

	it("runs grep tool calls through tool run hook", async () => {
		const fakeTransport = transport();
		const runnerCalls: unknown[] = [];
		const tools = {
			grep: {
				name: "grep",
				validate: async () => ({ success: true, data: null }),
				run: async () => {
					await Promise.resolve();
					return Promise.reject(
						new Error("fallback grep runner should not run"),
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
					content: [{ type: "text" as const, content: "src/a.txt:1:alpha" }],
				},
			};
		};

		const result = await runTool({
			abortSignal: new AbortController().signal,
			transport: fakeTransport,
			loaded: tools,
			call: {
				type: "tool-call",
				toolCallId: "grep-1",
				name: "grep",
				original: { pattern: "alpha", path: "src" },
				parsed: { pattern: "alpha", path: "src" },
			},
			config: baseConfig,
			toolRun: toolRun,
		});

		expect(result.success).toBe(true);
		expect(runnerCalls).toEqual([
			{
				toolName: "grep",
				cwd: "/repo",
				toolCallId: "grep-1",
				toolCall: {
					type: "tool-call",
					toolCallId: "grep-1",
					name: "grep",
					original: { pattern: "alpha", path: "src" },
					parsed: { pattern: "alpha", path: "src" },
				},
				parsed: { pattern: "alpha", path: "src" },
				modelContext: 200,
			},
		]);
	});
});
