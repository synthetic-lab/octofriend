import type { ImageInfo } from "../../input/image_attachments.ts";
import { trajectoryArc } from "../../internal/agent-trajectory-runtime/main.ts";
import type { Finish } from "../../internal/agent-trajectory-runtime/types.ts";
import { assertKeyForModel } from "../../internal/configuration/keys.ts";
import { getModelFromConfig } from "../../internal/configuration/model-selection.ts";
import type {
	HistoryItem,
	LlmHistoryItem,
} from "../../internal/conversation-history/main.ts";
import {
	outputToHistory,
	toLlmIR,
} from "../../internal/conversation-history/main.ts";
import type { OctoIR } from "../../internal/octo-agent-ir/main.ts";
import { errorToString } from "../result.ts";
import { throttledBuffer } from "./scheduling.ts";
import type { AppStateGet, AppStateSet, UiState } from "./types.ts";

let nextLocalMessageId = 1;

function createLocalMessageId(prefix: "user" | "assistant"): string {
	const id = `${prefix}-${nextLocalMessageId}`;
	nextLocalMessageId += 1;
	return id;
}

function linkToolCallToAssistant(
	toolCall: unknown,
	assistantMessageId: string,
): unknown {
	if (!toolCall || typeof toolCall !== "object") return toolCall;
	return { ...(toolCall as Record<string, unknown>), assistantMessageId };
}

function toolCallIdFrom(value: unknown): string | null {
	if (!value || typeof value !== "object") return null;
	const toolCallId = (value as Record<string, unknown>)["toolCallId"];
	return typeof toolCallId === "string" ? toolCallId : null;
}

function assistantMessageIdFromToolCall(value: unknown): string | null {
	if (!value || typeof value !== "object") return null;
	const assistantMessageId = (value as Record<string, unknown>)[
		"assistantMessageId"
	];
	return typeof assistantMessageId === "string" ? assistantMessageId : null;
}

type LinkableAssistantIR = Omit<
	Extract<OctoIR, { role: "assistant" }>,
	"messageId"
> & { messageId?: string };
type LinkableOctoIR = OctoIR | LinkableAssistantIR;
type LinkableHistoryItem =
	| Exclude<HistoryItem<OctoIR>, LlmHistoryItem<OctoIR>>
	| LlmHistoryItem<LinkableOctoIR>;

function linkedAssistantItem(
	item: LlmHistoryItem<LinkableOctoIR>,
	ir: Extract<OctoIR, { role: "assistant" }> & Record<string, unknown>,
	assistantByToolCallId: Map<string, string>,
): HistoryItem<OctoIR> {
	const messageId =
		typeof ir["messageId"] === "string"
			? ir["messageId"]
			: createLocalMessageId("assistant");
	const toolCalls = Array.isArray(ir.toolCalls)
		? ir.toolCalls.map((toolCall) => {
				const linkedToolCall = linkToolCallToAssistant(toolCall, messageId);
				const toolCallId = toolCallIdFrom(linkedToolCall);
				if (toolCallId) assistantByToolCallId.set(toolCallId, messageId);
				return linkedToolCall;
			})
		: ir.toolCalls;
	return {
		...item,
		ir: { ...ir, messageId, toolCalls } as OctoIR,
	};
}

function isToolResultLikeRole(role: string): boolean {
	return (
		role === "tool-output" ||
		role === "tool-runtime-error" ||
		role === "tool-validation-error" ||
		role === "tool-skip-output" ||
		role === "tool-reject"
	);
}

function linkedToolResultItem(
	item: LlmHistoryItem<LinkableOctoIR>,
	ir: OctoIR & Record<string, unknown>,
	assistantByToolCallId: Map<string, string>,
): HistoryItem<OctoIR> {
	const toolCall = ir.toolCall;
	const existingAssistantMessageId = assistantMessageIdFromToolCall(toolCall);
	const toolCallId = toolCallIdFrom(toolCall);
	const assistantMessageId =
		existingAssistantMessageId ??
		(toolCallId ? assistantByToolCallId.get(toolCallId) : null);
	if (!assistantMessageId) return item as HistoryItem<OctoIR>;
	return {
		...item,
		ir: {
			...ir,
			toolCall: linkToolCallToAssistant(toolCall, assistantMessageId),
		} as OctoIR,
	};
}

export function linkTrajectoryHistory(
	history: readonly LinkableHistoryItem[],
): HistoryItem<OctoIR>[] {
	const assistantByToolCallId = new Map<string, string>();
	return history.map((item): HistoryItem<OctoIR> => {
		if (item.type !== "llm-ir") return item;
		const ir = item.ir as OctoIR & Record<string, unknown>;
		if (ir.role === "assistant") {
			return linkedAssistantItem(item, ir, assistantByToolCallId);
		}
		if (isToolResultLikeRole(ir.role)) {
			return linkedToolResultItem(item, ir, assistantByToolCallId);
		}
		return item as HistoryItem<OctoIR>;
	});
}

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

function linkedToolCallsById(
	history: readonly HistoryItem<OctoIR>[],
): Map<string, NonNullable<UiState["pendingRejectedToolCall"]>> {
	const linked = new Map<
		string,
		NonNullable<UiState["pendingRejectedToolCall"]>
	>();
	for (const item of history) {
		if (item.type !== "llm-ir" || item.ir.role !== "assistant") continue;
		for (const toolCall of item.ir.toolCalls ?? []) {
			if (toolCall.type === "tool-call") {
				linked.set(toolCall.toolCallId, toolCall);
			}
		}
	}
	return linked;
}

export function linkFinishReasonToolCalls(
	finishReason: Finish["reason"],
	history: readonly HistoryItem<OctoIR>[],
): Finish["reason"] {
	if (finishReason.type !== "request-tool") return finishReason;
	const linkedToolCalls = linkedToolCallsById(history);
	return {
		...finishReason,
		toolCalls: finishReason.toolCalls.map(
			(toolCall) => linkedToolCalls.get(toolCall.toolCallId) ?? toolCall,
		),
	};
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

export function rejectedToolHistoryForUserMessage(
	history: readonly HistoryItem<OctoIR>[],
	rejectedToolCall: UiState["pendingRejectedToolCall"],
	rejectedByUserMessageId: string,
): HistoryItem<OctoIR>[] {
	if (!rejectedToolCall) return [];
	return [
		{
			type: "llm-ir",
			ir: {
				role: "tool-reject",
				toolCall: rejectedToolCall,
				rejectedByUserMessageId,
			},
		},
		...skippedCallsAfterRejectedTool(history, rejectedToolCall),
	];
}

function skippedCallsAfterRejectedTool(
	history: readonly HistoryItem<OctoIR>[],
	rejectedToolCall: NonNullable<UiState["pendingRejectedToolCall"]>,
): HistoryItem<OctoIR>[] {
	const assistantItem = [...history].reverse().find(
		(
			item,
		): item is HistoryItem<OctoIR> & {
			ir: Extract<OctoIR, { role: "assistant" }>;
		} =>
			item.type === "llm-ir" &&
			item.ir.role === "assistant" &&
			item.ir.toolCalls != null,
	);
	const toolCalls = assistantItem?.ir.toolCalls ?? [];
	const rejectedIndex = toolCalls.findIndex(
		(call) =>
			call.type === "tool-call" &&
			call.toolCallId === rejectedToolCall.toolCallId,
	);
	if (rejectedIndex < 0) return [];
	return toolCalls
		.slice(rejectedIndex + 1)
		.filter(
			(call): call is NonNullable<UiState["pendingRejectedToolCall"]> =>
				call.type === "tool-call",
		)
		.map((toolCall) => ({
			type: "llm-ir" as const,
			ir: {
				role: "tool-skip-output" as const,
				toolCall,
				reason: "A previous tool call was rejected, so this tool was skipped",
			},
		}));
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
					content: [
						{ type: "text", content: query },
						...(images ?? []).map((image: ImageInfo) => ({
							type: "image" as const,
							image,
						})),
					],
				},
			};

			const pendingRejectedToolCall = get().pendingRejectedToolCall;
			const rejectedToolHistory = pendingRejectedToolCall
				? rejectedToolHistoryForUserMessage(
						get().history,
						pendingRejectedToolCall,
						userMessageId,
					)
				: [];
			const history = [...get().history, ...rejectedToolHistory, userMessage];
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
				set({
					modeData: {
						mode: "request-error",
						error: "Trajectory arc bridge is required",
						curlCommand: null,
					},
				});
				return;
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
		"input" | "retryFrom" | "abortResponse" | "_maybeHandleAbort" | "runAgent"
	>;
}
