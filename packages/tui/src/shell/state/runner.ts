import type { OctoIR } from "../../runtime/agent/ir/main.ts";
import { assertKeyForModel } from "../../runtime/config/keys.ts";
import { getModelFromConfig } from "../../runtime/config/model-selection.ts";
import type { HistoryItem } from "../../runtime/history/main.ts";
import { outputToHistory, toLlmIR } from "../../runtime/history/main.ts";
import { trajectoryArc } from "../../runtime/run-log/main.ts";
import type { ProviderMetrics } from "../../runtime/run-log/types.ts";
import { errorToString } from "../result.ts";
import { handleFinishReason } from "./runner-finish.ts";
import {
	appendHistoryItems,
	createLocalMessageId,
	linkFinishReasonToolCalls,
	linkTrajectoryHistory,
	mergeTrajectoryFinishHistory,
	rejectedToolHistoryForUserMessage,
	userMessageContent,
} from "./runner-history.ts";
import { throttledMergeBuffer } from "./scheduling.ts";
import type { AppStateGet, AppStateSet, UiState } from "./types.ts";

export function formatProviderMetrics(metrics: ProviderMetrics): string {
	const label =
		metrics.phase === "compaction" ? "Compaction" : "Provider response";
	const ttft =
		metrics.ttftMs === null
			? "unavailable"
			: `${(metrics.ttftMs / 1000).toFixed(3)}s`;
	const generationMs =
		metrics.ttftMs === null
			? metrics.durationMs
			: Math.max(0, metrics.durationMs - metrics.ttftMs);
	const tokensPerSecond =
		generationMs > 0 ? metrics.outputTokens / (generationMs / 1000) : 0;
	return `${label}: TTFT ${ttft} · ${tokensPerSecond.toFixed(2)} tok/s · ${metrics.outputTokens} output tokens`;
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
			const userMessageId = createLocalMessageId("user");
			const userMessage: HistoryItem<OctoIR> = {
				type: "llm-ir",
				ir: {
					role: "user",
					messageId: userMessageId,
					content: userMessageContent(query, images),
				},
			};

			const state = get();
			const baseHistory = state.history;
			const pendingRejectedToolCall = state.pendingRejectedToolCall;
			const rejectedToolHistory = pendingRejectedToolCall
				? rejectedToolHistoryForUserMessage(
						baseHistory,
						pendingRejectedToolCall,
						userMessageId,
					)
				: [];
			const history: HistoryItem<OctoIR>[] = [];
			appendHistoryItems(history, baseHistory);
			appendHistoryItems(history, rejectedToolHistory);
			history.push(userMessage);
			set({
				history,
				lastUserPromptIndex: history.length - 1,
				pendingRejectedToolCall: null,
			});
			await get().runAgent({
				config,
				transport,
				trajectoryArcRun,
				toolPermission,
				toolRun,
			});
		},

		compactHistory: async (args) => {
			if (get().history.length === 0) return;
			await get().runAgent({ ...args, compactOnly: true });
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

		runAgent: async ({ config, transport, trajectoryArcRun, compactOnly }) => {
			let baseHistory = [...get().history];
			const abortController = new AbortController();
			let compactionByteCount = 0;
			let responseByteCount = 0;
			const model = getModelFromConfig(config, get().modelOverride);
			const apiKey = await assertKeyForModel(model, config);
			if (!trajectoryArcRun) {
				set({
					modeData: {
						mode: "request-error",
						error: "Trajectory arc bridge is required",
						curlCommand: null,
					},
				});
				return;
			}

			const throttle = throttledMergeBuffer<Partial<UiState>>(300, set);
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
					compactOnly,
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
							baseHistory = outputToHistory(event.history);
							set({ history: [...baseHistory] });
						},

						providerMetrics: (event) => {
							if (config.showProviderMetrics !== true) return;
							baseHistory = [
								...baseHistory,
								{ type: "notification", content: formatProviderMetrics(event) },
							];
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
									linkTrajectoryHistory(outputToHistory(event.irs)),
								),
							});
						},
					},
				});
				throttle.flush();
				const finishHistory = linkTrajectoryHistory(
					outputToHistory(finish.irs),
				);
				const finalHistory = mergeTrajectoryFinishHistory(
					baseHistory,
					finishHistory,
				);
				baseHistory = finalHistory;
				set({ history: [...baseHistory] });
				handleFinishReason({
					config,
					finishReason: linkFinishReasonToolCalls(finish.reason, finalHistory),
					get,
					set,
				});
			} catch (error) {
				if (get()._maybeHandleAbort(abortController.signal)) {
					return;
				}

				set({
					modeData: {
						mode: "request-error",
						error: errorToString(error),
						curlCommand: null,
					},
				});
			} finally {
				set({ byteCount: 0 });
			}
		},
	} satisfies Pick<
		UiState,
		| "input"
		| "compactHistory"
		| "retryFrom"
		| "abortResponse"
		| "_maybeHandleAbort"
		| "runAgent"
	>;
}
