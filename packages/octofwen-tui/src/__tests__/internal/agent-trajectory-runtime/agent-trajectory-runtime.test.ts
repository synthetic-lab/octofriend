import { describe, expect, test } from "bun:test";
import { trajectoryArc } from "../../../internal/agent-trajectory-runtime/main.ts";
import type { Transport } from "../../../internal/transport/common.ts";

describe("agent trajectory runtime", () => {
	test("delegates trajectory execution to trajectory arc bridge", async () => {
		const calls: unknown[] = [];
		const finish = await trajectoryArc({
			apiKey: "test-key",
			model: {
				nickname: "test-model",
				model: "gpt-test",
				baseUrl: "https://api.example.test/v1",
				context: 1000,
				reasoning: "xhigh",
				thinkingBudgetTokens: 12000,
			},
			messages: [
				{ role: "user", content: [{ type: "text", content: "hello" }] },
			],
			config: {
				configVersion: 2,
				yourName: "Test User",
				models: [],
			},
			transport: fakeTransport(),
			abortSignal: new AbortController().signal,
			trajectoryArcRun: async (params, options) => {
				await Promise.resolve();
				calls.push({ params, options });
				return {
					type: "finish",
					irs: [assistantMessage("answer")],
					reason: { type: "needs-response" },
					events: [],
				};
			},
			handler: quietHandler(),
		});

		expect(calls).toHaveLength(1);
		expect(calls[0]).toEqual({
			params: {
				cwd: ".",
				apiKey: "test-key",
				model: {
					type: undefined,
					baseUrl: "https://api.example.test/v1",
					model: "gpt-test",
					context: 1000,
					reasoning: "xhigh",
					thinkingBudgetTokens: 12000,
					modalities: undefined,
				},
				messages: [
					{ role: "user", content: [{ type: "text", content: "hello" }] },
				],
				config: {
					yourName: "Test User",
					mcpServers: undefined,
					search: undefined,
					hasWebSearch: false,
					skills: undefined,
					defaultApiKeyOverrides: undefined,
					authModels: [],
					fixJson: undefined,
				},
				aborted: false,
			},
			options: {
				abortSignal: expect.anything(),
				cancelOnAbort: true,
			},
		});
		expect(finish).toEqual({
			type: "finish",
			irs: [assistantMessage("answer")],
			reason: { type: "needs-response" },
		});
	});

	test("passes aborted state to trajectory arc bridge", async () => {
		const controller = new AbortController();
		controller.abort();
		const seen: boolean[] = [];

		const finish = await trajectoryArc({
			apiKey: "test-key",
			model: {
				nickname: "test-model",
				model: "trajectory-token-test-model",
				baseUrl: "https://api.example.test/v1",
				context: 1000,
			},
			messages: [],
			config: {
				configVersion: 2,
				yourName: "Test User",
				models: [],
			},
			transport: fakeTransport(),
			abortSignal: controller.signal,
			trajectoryArcRun: async (params) => {
				await Promise.resolve();
				seen.push(params.aborted === true);
				return {
					type: "finish",
					irs: [],
					reason: { type: "abort" },
					events: [],
				};
			},
			handler: quietHandler(),
		});

		expect(seen).toEqual([true]);
		expect(finish).toEqual({
			type: "finish",
			irs: [],
			reason: { type: "abort" },
		});
	});

	test("replays trajectory arc events to presentation handlers", async () => {
		const events: string[] = [];
		const quotaUpdates: unknown[] = [];
		const finish = await trajectoryArc({
			apiKey: "test-key",
			model: {
				nickname: "test-model",
				model: "trajectory-token-test-model",
				baseUrl: "https://api.example.test/v1",
				context: 1000,
			},
			messages: [],
			config: {
				configVersion: 2,
				yourName: "Test User",
				models: [],
			},
			transport: fakeTransport(),
			abortSignal: new AbortController().signal,
			trajectoryArcRun: async () => ({
				type: "finish",
				irs: [assistantMessage("hello")],
				reason: { type: "needs-response" },
				events: [
					{ type: "start-response" },
					{
						type: "response-progress",
						buffer: { content: "hel", reasoning: null, tool: null },
						delta: { type: "content", value: "hel" },
					},
					{
						type: "quota-updated",
						quota: {
							rollingFiveHourLimit: {
								remaining: 3,
								max: 4,
								nextTickAt: "2026-01-02T03:04:05Z",
								tickPercent: 75,
							},
						},
					},
					{ type: "retry-tool", irs: [assistantMessage("retry")] },
				],
			}),
			handler: {
				...quietHandler(),
				startResponse: () => events.push("start-response"),
				responseProgress: (event) => events.push(event.delta.value),
				retryTool: () => events.push("retry-tool"),
				onQuotaUpdated: (quota) => quotaUpdates.push(quota),
			},
		});

		expect(events).toEqual(["start-response", "hel", "retry-tool"]);
		expect(quotaUpdates).toHaveLength(1);
		expect(
			(quotaUpdates[0] as { rollingFiveHourLimit: { nextTickAt: Date } })
				.rollingFiveHourLimit.nextTickAt,
		).toBeInstanceOf(Date);
		expect(finish.reason).toEqual({ type: "needs-response" });
	});

	test("records trajectory token usage for the active model", async () => {
		const { tokenCounts } = await import("../../../app/token_usage.ts");
		await trajectoryArc({
			apiKey: "test-key",
			model: {
				nickname: "test-model",
				model: "trajectory-token-test-model",
				baseUrl: "https://api.example.test/v1",
				context: 1000,
			},
			messages: [],
			config: {
				configVersion: 2,
				yourName: "Test User",
				models: [],
			},
			transport: fakeTransport(),
			abortSignal: new AbortController().signal,
			trajectoryArcRun: async () => ({
				type: "finish",
				irs: [],
				reason: { type: "needs-response" },
				events: [{ type: "token-usage", input: 11, output: 7 }],
			}),
			handler: quietHandler(),
		});

		expect(tokenCounts()["trajectory-token-test-model"]).toEqual({
			input: 11,
			output: 7,
		});
	});

	test("forwards fixJson auth metadata and default web-search availability", async () => {
		const previousSynthetic = process.env["SYNTHETIC_API_KEY"];
		const previousFix = process.env["FIX_JSON_KEY"];
		process.env["SYNTHETIC_API_KEY"] = "synthetic-key";
		process.env["FIX_JSON_KEY"] = "fix-key";
		try {
			const calls: unknown[] = [];
			await trajectoryArc({
				apiKey: "test-key",
				model: {
					nickname: "test-model",
					model: "gpt-test",
					baseUrl: "https://api.example.test/v1",
					context: 1000,
				},
				messages: [],
				config: {
					configVersion: 2,
					yourName: "Test User",
					models: [],
					fixJson: {
						baseUrl: "https://fix.example/v1",
						apiEnvVar: "FIX_JSON_KEY",
						model: "fix-model",
					},
				},
				transport: fakeTransport(),
				abortSignal: new AbortController().signal,
				trajectoryArcRun: async (params) => {
					await Promise.resolve();
					calls.push(params.config);
					return {
						type: "finish",
						irs: [],
						reason: { type: "needs-response" },
						events: [],
					};
				},
				handler: quietHandler(),
			});

			expect(calls[0]).toEqual(
				expect.objectContaining({
					hasWebSearch: true,
					authModels: [
						{
							baseUrl: "https://fix.example/v1",
							apiEnvVar: "FIX_JSON_KEY",
							auth: undefined,
						},
					],
					fixJson: {
						baseUrl: "https://fix.example/v1",
						apiEnvVar: "FIX_JSON_KEY",
						auth: undefined,
						model: "fix-model",
					},
				}),
			);
		} finally {
			if (previousSynthetic === undefined)
				delete process.env["SYNTHETIC_API_KEY"];
			else process.env["SYNTHETIC_API_KEY"] = previousSynthetic;
			if (previousFix === undefined) delete process.env["FIX_JSON_KEY"];
			else process.env["FIX_JSON_KEY"] = previousFix;
		}
	});
});

function assistantMessage(content: string) {
	return {
		role: "assistant" as const,
		content,
		usage: { input: { cached: 0, uncached: 0, total: 0 }, output: 0 },
	};
}

function fakeTransport(): Transport {
	return {
		cwd: ".",
		writeFile: () => Promise.resolve(),
		readFile: () => Promise.resolve(""),
		pathExists: () => Promise.resolve(false),
		isDirectory: () => Promise.resolve(false),
		mkdir: () => Promise.resolve(),
		readdir: () => Promise.resolve([]),
		modTime: () => Promise.resolve(0),
		resolvePath: (_signal, path) => Promise.resolve(path),
		shell: () => Promise.resolve(""),
		close: () => Promise.resolve(),
	};
}

function quietHandler() {
	return {
		startResponse: () => undefined,
		responseProgress: () => undefined,
		startCompaction: () => undefined,
		compactionProgress: () => undefined,
		compactionParsed: () => undefined,
		autofixingJson: () => undefined,
		autofixingDiff: () => undefined,
		retryTool: () => undefined,
		onQuotaUpdated: () => undefined,
	};
}
