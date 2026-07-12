import { describe, expect, test } from "bun:test";
import { trajectoryArc } from "../../../src/runtime/run-log/main.ts";
import type { Transport } from "../../../src/runtime/workspace/common.ts";

const CURRENT_CONFIG_VERSION = 6;

function echoCommand(value: string): string[] {
	return [process.execPath, "--eval", `console.log(${JSON.stringify(value)})`];
}

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
				configVersion: CURRENT_CONFIG_VERSION,
				yourName: "Test User",
				models: [],
				defaultApiKeyOverrides: { synthetic: "MISSING_SYNTHETIC_TEST_KEY" },
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
					defaultApiKeyOverrides: {
						synthetic: "MISSING_SYNTHETIC_TEST_KEY",
					},
					authModels: [],
					fixJson: undefined,
				},
				aborted: false,
				compactOnly: false,
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
				configVersion: CURRENT_CONFIG_VERSION,
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
		const compactedHistories: unknown[] = [];
		const metrics: unknown[] = [];
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
				configVersion: CURRENT_CONFIG_VERSION,
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
					{
						type: "compaction-parsed",
						checkpoint: {
							role: "checkpoint",
							content: [{ type: "text", content: "summary" }],
						},
						history: [
							{
								role: "checkpoint",
								content: [{ type: "text", content: "summary" }],
							},
							{ role: "user", content: [{ type: "text", content: "recent" }] },
						],
					},
					{
						type: "provider-metrics",
						phase: "response",
						ttftMs: 125,
						durationMs: 1125,
						outputTokens: 20,
					},
					{ type: "retry-tool", irs: [assistantMessage("retry")] },
				],
			}),
			handler: {
				...quietHandler(),
				startResponse: () => events.push("start-response"),
				responseProgress: (event) => events.push(event.delta.value),
				compactionParsed: (event) => compactedHistories.push(event.history),
				providerMetrics: (event) => metrics.push(event),
				retryTool: () => events.push("retry-tool"),
				onQuotaUpdated: (quota) => quotaUpdates.push(quota),
			},
		});

		expect(events).toEqual(["start-response", "hel", "retry-tool"]);
		expect(compactedHistories).toEqual([
			[
				{ role: "checkpoint", content: [{ type: "text", content: "summary" }] },
				{ role: "user", content: [{ type: "text", content: "recent" }] },
			],
		]);
		expect(metrics).toEqual([
			{ phase: "response", ttftMs: 125, durationMs: 1125, outputTokens: 20 },
		]);
		expect(quotaUpdates).toHaveLength(1);
		expect(
			(quotaUpdates[0] as { rollingFiveHourLimit: { nextTickAt: Date } })
				.rollingFiveHourLimit.nextTickAt,
		).toBeInstanceOf(Date);
		expect(finish.reason).toEqual({ type: "needs-response" });
	});

	test("ignores malformed quota arc events without breaking finish", async () => {
		const circularQuota: Record<string, unknown> = {};
		circularQuota["self"] = circularQuota;
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
				configVersion: CURRENT_CONFIG_VERSION,
				yourName: "Test User",
				models: [],
			},
			transport: fakeTransport(),
			abortSignal: new AbortController().signal,
			trajectoryArcRun: async () => ({
				type: "finish",
				irs: [assistantMessage("done")],
				reason: { type: "needs-response" },
				events: [{ type: "quota-updated", quota: circularQuota }],
			}),
			handler: quietHandler(),
		});

		expect(finish.reason).toEqual({ type: "needs-response" });
	});

	test("records trajectory token usage for the active model", async () => {
		const { tokenCounts } = await import("../../../src/shell/token-usage.ts");
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
				configVersion: CURRENT_CONFIG_VERSION,
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
				configVersion: CURRENT_CONFIG_VERSION,
				yourName: "Test User",
				models: [],
				search: {
					url: "https://search.example",
					auth: { type: "command", command: echoCommand("search-key") },
				},
				fixJson: {
					type: "gemini",
					baseUrl: "https://fix.example/v1",
					auth: { type: "env", name: "FIX_JSON_KEY" },
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
						type: "gemini",
						baseUrl: "https://fix.example/v1",
						apiEnvVar: undefined,
						auth: { type: "env", name: "FIX_JSON_KEY" },
					},
				],
				fixJson: {
					type: "gemini",
					baseUrl: "https://fix.example/v1",
					apiEnvVar: undefined,
					auth: { type: "env", name: "FIX_JSON_KEY" },
					model: "fix-model",
				},
			}),
		);
	});
});

function assistantMessage(content: string) {
	return {
		role: "assistant" as const,
		messageId: `assistant-${content}`,
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
		providerMetrics: () => undefined,
		autofixingJson: () => undefined,
		autofixingDiff: () => undefined,
		retryTool: () => undefined,
		onQuotaUpdated: () => undefined,
	};
}
