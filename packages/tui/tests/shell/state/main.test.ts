import { describe, expect, test } from "bun:test";

import {
	linkFinishReasonToolCalls,
	linkTrajectoryHistory,
	mergeTrajectoryFinishHistory,
	rejectedToolHistoryForUserMessage,
} from "../../../src/shell/state/runner-history";
import { useAppStore } from "../../../src/shell/state/store";

const ASSISTANT_MESSAGE_ID_PREFIX = /^assistant-/;

describe("terminal app state", () => {
	test("debounces ready-for-input notifications by replacing pending timers", () => {
		const originalSetTimeout = globalThis.setTimeout;
		const originalClearTimeout = globalThis.clearTimeout;
		const timers: ReturnType<typeof setTimeout>[] = [];
		const cleared: (ReturnType<typeof setTimeout> | undefined)[] = [];

		globalThis.setTimeout = ((handler: TimerHandler, timeout?: number) => {
			const timer = { handler, timeout } as unknown as ReturnType<
				typeof setTimeout
			>;
			timers.push(timer);
			return timer;
		}) as unknown as typeof setTimeout;
		globalThis.clearTimeout = ((timer?: ReturnType<typeof setTimeout>) => {
			cleared.push(timer);
		}) as unknown as typeof clearTimeout;

		try {
			useAppStore.setState({
				_notifyTimer: null,
				sessionAutoNotify: false,
				notifyOnce: false,
			});
			const config = {
				yourName: "Test User",
				models: [],
				notifications: {
					notifyCommand: "notify",
					notifyTimeoutMs: 1000,
					alwaysNotify: true,
				},
			};

			useAppStore.getState().notifyReadyForInput(config);
			useAppStore.getState().notifyReadyForInput(config);

			expect(timers).toHaveLength(2);
			expect(cleared).toEqual([timers[0]]);
			expect(useAppStore.getState()._notifyTimer).toBe(timers[1]);
		} finally {
			globalThis.setTimeout = originalSetTimeout;
			globalThis.clearTimeout = originalClearTimeout;
			useAppStore.setState({ _notifyTimer: null });
		}
	});

	test("aborted responses return to input mode and reset vim mode", () => {
		const controller = new AbortController();
		controller.abort();

		useAppStore.setState({
			modeData: {
				mode: "responding",
				inflightResponse: {
					type: "inflight-response",
					content: "partial response",
				},
				abortController: controller,
			},
		});

		expect(useAppStore.getState()._maybeHandleAbort(controller.signal)).toBe(
			true,
		);
		expect(useAppStore.getState().modeData).toEqual({
			mode: "input",
			vimMode: "INSERT",
		});
	});
});

test("trajectory finish merge de-duplicates an already active checkpoint", () => {
	const checkpoint = {
		type: "llm-ir" as const,
		ir: {
			role: "checkpoint" as const,
			content: [{ type: "text" as const, content: "summary" }],
		},
	};
	const previousAssistant = {
		type: "llm-ir" as const,
		ir: {
			role: "assistant" as const,
			messageId: "assistant-previous",
			content: "previous",
			usage: { input: { cached: 0, uncached: 0, total: 0 }, output: 0 },
		},
	};
	const user = {
		type: "llm-ir" as const,
		ir: {
			role: "user" as const,
			messageId: "user-continue",
			content: [{ type: "text" as const, content: "continue" }],
		},
	};
	const nextAssistant = {
		type: "llm-ir" as const,
		ir: {
			role: "assistant" as const,
			messageId: "assistant-next",
			content: "next",
			usage: { input: { cached: 0, uncached: 0, total: 0 }, output: 0 },
		},
	};

	expect(
		mergeTrajectoryFinishHistory(
			[checkpoint, previousAssistant, user],
			[checkpoint, nextAssistant],
		),
	).toEqual([checkpoint, previousAssistant, user, nextAssistant]);
});

test("trajectory history links assistant messages to tool calls and outputs", () => {
	const linked = linkTrajectoryHistory([
		{
			type: "llm-ir",
			ir: {
				role: "assistant",
				content: "",
				usage: { input: { cached: 0, uncached: 0, total: 0 }, output: 0 },
				toolCalls: [
					{
						type: "tool-call",
						name: "read",
						toolCallId: "call-1",
						original: { filePath: "README.md" },
						parsed: { filePath: "README.md" },
					},
				],
			},
		},
		{
			type: "llm-ir",
			ir: {
				role: "tool-output",
				toolCall: {
					type: "tool-call",
					name: "read",
					toolCallId: "call-1",
					original: { filePath: "README.md" },
					parsed: { filePath: "README.md" },
				},
				content: [{ type: "text", content: "contents" }],
			},
		},
	]);

	const assistant = linked[0];
	const output = linked[1];
	expect(assistant.type).toBe("llm-ir");
	expect(output.type).toBe("llm-ir");
	if (assistant.type !== "llm-ir" || output.type !== "llm-ir") return;
	expect(assistant.ir.role).toBe("assistant");
	expect(output.ir.role).toBe("tool-output");
	if (assistant.ir.role !== "assistant" || output.ir.role !== "tool-output")
		return;
	expect(assistant.ir.messageId).toMatch(ASSISTANT_MESSAGE_ID_PREFIX);
	const toolCall = assistant.ir.toolCalls?.[0];
	expect(toolCall?.type).toBe("tool-call");
	if (toolCall?.type !== "tool-call") return;
	expect(toolCall.assistantMessageId).toBe(assistant.ir.messageId);
	expect(output.ir.toolCall.assistantMessageId).toBe(assistant.ir.messageId);
});

test("tool rejection history links the rejection to the user message that rejected it", () => {
	const toolCall = {
		type: "tool-call" as const,
		name: "read",
		toolCallId: "call-1",
		assistantMessageId: "assistant-1",
		original: { filePath: "README.md" },
		parsed: { filePath: "README.md" },
	};

	expect(rejectedToolHistoryForUserMessage([], toolCall, "user-1")[0]).toEqual({
		type: "llm-ir",
		ir: {
			role: "tool-reject",
			toolCall,
			rejectedByUserMessageId: "user-1",
		},
	});
});

test("tool rejection history skips later tool calls from the same assistant turn", () => {
	const firstToolCall = {
		type: "tool-call" as const,
		name: "read",
		toolCallId: "call-1",
		assistantMessageId: "assistant-1",
		original: { filePath: "README.md" },
		parsed: { filePath: "README.md" },
	};
	const secondToolCall = {
		type: "tool-call" as const,
		name: "read",
		toolCallId: "call-2",
		assistantMessageId: "assistant-1",
		original: { filePath: "package.json" },
		parsed: { filePath: "package.json" },
	};

	expect(
		rejectedToolHistoryForUserMessage(
			[
				{
					type: "llm-ir",
					ir: {
						role: "assistant",
						content: "",
						messageId: "assistant-1",
						usage: {
							input: { cached: 0, uncached: 0, total: 0 },
							output: 0,
						},
						toolCalls: [firstToolCall, secondToolCall],
					},
				},
			],
			firstToolCall,
			"user-1",
		).map((item) => (item.type === "llm-ir" ? item.ir.role : item.type)),
	).toEqual(["tool-reject", "tool-skip-output"]);
});

test("empty request-tool finish reasons keep object identity", () => {
	const reason = { type: "request-tool" as const, toolCalls: [] };

	expect(linkFinishReasonToolCalls(reason, [])).toBe(reason);
});

test("request-tool finish reasons without linked tool calls keep object identity", () => {
	const reason = {
		type: "request-tool" as const,
		toolCalls: [
			{
				type: "tool-call" as const,
				name: "read",
				toolCallId: "call-1",
				original: { filePath: "README.md" },
				parsed: { filePath: "README.md" },
			},
		],
	};

	expect(linkFinishReasonToolCalls(reason, [])).toBe(reason);
});

test("request-tool finish reasons prefer newest linked tool call", () => {
	const olderToolCall = {
		type: "tool-call" as const,
		name: "read",
		toolCallId: "call-1",
		assistantMessageId: "assistant-old",
		original: { filePath: "old.md" },
		parsed: { filePath: "old.md" },
	};
	const newerToolCall = {
		type: "tool-call" as const,
		name: "read",
		toolCallId: "call-1",
		assistantMessageId: "assistant-new",
		original: { filePath: "new.md" },
		parsed: { filePath: "new.md" },
	};

	const reason = linkFinishReasonToolCalls(
		{
			type: "request-tool",
			toolCalls: [
				{
					type: "tool-call",
					name: "read",
					toolCallId: "call-1",
					original: { filePath: "raw.md" },
					parsed: { filePath: "raw.md" },
				},
			],
		},
		[
			{
				type: "llm-ir",
				ir: {
					role: "assistant",
					messageId: "assistant-old",
					content: "",
					usage: { input: { cached: 0, uncached: 0, total: 0 }, output: 0 },
					toolCalls: [olderToolCall],
				},
			},
			{
				type: "llm-ir",
				ir: {
					role: "assistant",
					messageId: "assistant-new",
					content: "",
					usage: { input: { cached: 0, uncached: 0, total: 0 }, output: 0 },
					toolCalls: [newerToolCall],
				},
			},
		],
	);

	expect(reason.type).toBe("request-tool");
	if (reason.type !== "request-tool") return;
	expect(reason.toolCalls[0]).toBe(newerToolCall);
});

test("request-tool finish reasons reuse linked tool calls from finished history", () => {
	const assistant = linkTrajectoryHistory([
		{
			type: "llm-ir",
			ir: {
				role: "assistant",
				content: "",
				usage: { input: { cached: 0, uncached: 0, total: 0 }, output: 0 },
				toolCalls: [
					{
						type: "tool-call",
						name: "read",
						toolCallId: "call-1",
						original: { filePath: "README.md" },
						parsed: { filePath: "README.md" },
					},
				],
			},
		},
	]);

	const reason = linkFinishReasonToolCalls(
		{
			type: "request-tool",
			toolCalls: [
				{
					type: "tool-call",
					name: "read",
					toolCallId: "call-1",
					original: { filePath: "README.md" },
					parsed: { filePath: "README.md" },
				},
			],
		},
		assistant,
	);

	expect(reason.type).toBe("request-tool");
	if (reason.type !== "request-tool") return;
	expect(reason.toolCalls[0]?.assistantMessageId).toMatch(
		ASSISTANT_MESSAGE_ID_PREFIX,
	);
});
