import type { Finish } from "../../internal/agent-trajectory-runtime/types.ts";
import type { AppStateGet, AppStateSet, UiState } from "./types.ts";

export function handleFinishReason({
	config,
	finishReason,
	get,
	set,
}: {
	config: Parameters<UiState["notifyReadyForInput"]>[0];
	finishReason: Finish["reason"];
	get: AppStateGet;
	set: AppStateSet;
}): void {
	if (finishReason.type === "abort" || finishReason.type === "needs-response") {
		get().notifyReadyForInput(config);
		set({ modeData: { mode: "input", vimMode: "INSERT" } });
		return;
	}

	if (finishReason.type === "request-error") {
		set({
			modeData: {
				mode: "request-error",
				error: finishReason.requestError,
				curlCommand: finishReason.curl,
			},
		});
		return;
	}

	if (finishReason.type === "auth-error") {
		set({
			modeData: {
				mode: "auth-error",
				error: finishReason.requestError,
			},
		});
		return;
	}

	if (finishReason.type === "payment-error") {
		set({
			modeData: {
				mode: "payment-error",
				error: finishReason.requestError,
			},
		});
		return;
	}

	if (finishReason.type === "rate-limit-error") {
		set({
			modeData: {
				mode: "rate-limit-error",
				error: finishReason.requestError,
			},
		});
		return;
	}

	if (finishReason.type === "compaction-error") {
		set({
			modeData: {
				mode: "compaction-error",
				error: finishReason.requestError,
				curlCommand: finishReason.curl,
			},
			history: [
				...get().history,
				{
					type: "compaction-failed",
				},
			],
		});
		return;
	}

	set({
		modeData: {
			mode: "tool-call",
			toolReqs: finishReason.toolCalls,
			runningToolCallId: null,
			abortController: new AbortController(),
		},
	});
}
