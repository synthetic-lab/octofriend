import { describe, expect, test } from "bun:test";
import { mergeTrajectoryFinishHistory } from "../../../app/state/agent-runner.ts";
import { useAppStore } from "../../../app/state/store.ts";

describe("terminal app state", () => {
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
			content: "previous",
			usage: { input: { cached: 0, uncached: 0, total: 0 }, output: 0 },
		},
	};
	const user = {
		type: "llm-ir" as const,
		ir: {
			role: "user" as const,
			content: [{ type: "text" as const, content: "continue" }],
		},
	};
	const nextAssistant = {
		type: "llm-ir" as const,
		ir: {
			role: "assistant" as const,
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
