import type { ImageInfo } from "../../input/image_attachments.ts";
import { trajectoryArc } from "../../internal/agent-trajectory-runtime/main.ts";
import type { Finish } from "../../internal/agent-trajectory-runtime/types.ts";
import { assertKeyForModel } from "../../internal/configuration/keys.ts";
import { getModelFromConfig } from "../../internal/configuration/model-selection.ts";
import type { HistoryItem } from "../../internal/conversation-history/main.ts";
import {
	outputToHistory,
	toLlmIR,
} from "../../internal/conversation-history/main.ts";
import type { OctoIR } from "../../internal/octo-agent-ir/main.ts";
import { throttledBuffer } from "./scheduling.ts";
import type { AppStateGet, AppStateSet, UiState } from "./types.ts";

function handleFinishReason({
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

function historyItemJson(item: HistoryItem<OctoIR>): string {
	return JSON.stringify(item);
}

function firstActiveCheckpoint(
	history: readonly HistoryItem<OctoIR>[],
): HistoryItem<OctoIR> | undefined {
	return history.find(
		(item) => item.type === "llm-ir" && item.ir.role === "checkpoint",
	);
}

export function mergeTrajectoryFinishHistory(
	baseHistory: readonly HistoryItem<OctoIR>[],
	finishHistory: readonly HistoryItem<OctoIR>[],
): HistoryItem<OctoIR>[] {
	const activeCheckpoint = firstActiveCheckpoint(baseHistory);
	const [firstFinishItem, ...remainingFinishHistory] = finishHistory;
	if (
		activeCheckpoint &&
		firstFinishItem?.type === "llm-ir" &&
		firstFinishItem.ir.role === "checkpoint" &&
		historyItemJson(activeCheckpoint) === historyItemJson(firstFinishItem)
	) {
		return [...baseHistory, ...remainingFinishHistory];
	}
	return [...baseHistory, ...finishHistory];
}

export function createAgentActions(set: AppStateSet, get: AppStateGet) {
	return {
		input: async ({
			config,
			query,
			transport,
			images,
			trajectoryArcRun,
			toolPermission,
			toolRun,
		}) => {
			const userMessage: HistoryItem<OctoIR> = {
				type: "llm-ir",
				ir: {
					role: "user",
					content: [
						{ type: "text", content: query },
						...(images ?? []).map((image: ImageInfo) => ({
							type: "image" as const,
							image,
						})),
					],
				},
			};

			const history = [...get().history, userMessage];
			set({ history, lastUserPromptIndex: history.length - 1 });
			await get().runAgent({
				config,
				transport,
				trajectoryArcRun,
				toolPermission,
				toolRun,
			});
		},

		retryFrom: async (mode, args) => {
			if (get().modeData.mode === mode) {
				await get().runAgent(args);
			}
		},

		abortResponse: () => {
			const { modeData } = get();
			if ("abortController" in modeData) modeData.abortController.abort();
		},

		_maybeHandleAbort: (signal: AbortSignal): boolean => {
			if (signal.aborted) {
				set({
					modeData: {
						mode: "input",
						vimMode: "INSERT",
					},
				});
				return true;
			}
			return false;
		},

		runAgent: async ({ config, transport, trajectoryArcRun }) => {
			let baseHistory = [...get().history];
			const abortController = new AbortController();
			let compactionByteCount = 0;
			let responseByteCount = 0;
			const model = getModelFromConfig(config, get().modelOverride);
			const apiKey = await assertKeyForModel(model, config);
			if (!trajectoryArcRun) {
				throw new Error("Trajectory arc bridge is required");
			}

			const throttle = throttledBuffer<Partial<UiState>>(300, set);
			set({
				modeData: {
					mode: "responding",
					inflightResponse: { type: "inflight-response", content: "" },
					abortController,
				},
			});

			try {
				const finish = await trajectoryArc({
					apiKey,
					model,
					messages: toLlmIR(baseHistory),
					config,
					transport,
					abortSignal: abortController.signal,
					trajectoryArcRun,
					handler: {
						startResponse: () => {
							throttle.flush();
							set({
								modeData: {
									mode: "responding",
									inflightResponse: {
										type: "inflight-response",
										content: "",
									},
									abortController,
								},
								byteCount: responseByteCount,
							});
						},

						responseProgress: (event) => {
							responseByteCount += event.delta.value.length;
							throttle.emit({
								modeData: {
									mode: "responding",
									inflightResponse: {
										type: "inflight-response",
										reasoningContent: event.buffer.reasoning,
										content: event.buffer.content || "",
									},
									abortController,
								},
								byteCount: responseByteCount,
							});
						},

						startCompaction: () => {
							throttle.flush();
							set({
								modeData: {
									mode: "compacting",
									inflightResponse: {
										type: "inflight-response",
										content: "",
									},
									abortController,
								},
								byteCount: compactionByteCount,
							});
						},

						compactionProgress: (event) => {
							compactionByteCount += event.delta.value.length;
							throttle.emit({
								modeData: {
									mode: "compacting",
									inflightResponse: {
										type: "inflight-response",
										reasoningContent: event.buffer.reasoning,
										content: event.buffer.content || "",
									},
									abortController,
								},
								byteCount: compactionByteCount,
							});
						},

						compactionParsed: (event) => {
							throttle.flush();
							const checkpointItem: HistoryItem<OctoIR> = {
								type: "llm-ir",
								ir: event.checkpoint,
							};
							baseHistory = [checkpointItem];
							set({ history: [...baseHistory] });
						},

						autofixingJson: () => {
							throttle.flush();
							set({
								modeData: {
									mode: "fix-json",
									abortController,
								},
							});
						},

						autofixingDiff: () => {
							throttle.flush();
							set({
								modeData: {
									mode: "diff-apply",
									abortController,
								},
							});
						},

						onQuotaUpdated: (quota) => set({ quotaData: quota }),

						retryTool: (event) => {
							throttle.flush();
							set({
								history: mergeTrajectoryFinishHistory(
									baseHistory,
									outputToHistory(event.irs),
								),
							});
						},
					},
				});
				throttle.flush();
				const finishHistory = outputToHistory(finish.irs);
				const finalHistory = mergeTrajectoryFinishHistory(
					baseHistory,
					finishHistory,
				);
				baseHistory = finalHistory;
				set({ history: [...baseHistory] });
				handleFinishReason({
					config,
					finishReason: finish.reason,
					get,
					set,
				});
			} catch (error) {
				if (get()._maybeHandleAbort(abortController.signal)) {
					return;
				}

				throw error;
			} finally {
				set({ byteCount: 0 });
			}
		},
	} satisfies Pick<
		UiState,
		"input" | "retryFrom" | "abortResponse" | "_maybeHandleAbort" | "runAgent"
	>;
}
