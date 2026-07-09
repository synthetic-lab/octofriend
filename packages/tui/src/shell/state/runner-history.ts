import type { ImageInfo } from "../../input/images";
import type { HistoryItem } from "../../runtime/history/main";
import type { OctoIR } from "../../runtime/agent/ir/main";
import {
	linkFinishReasonToolCalls as linkFinishReasonToolCallsImpl,
	linkTrajectoryHistory as linkTrajectoryHistoryImpl,
} from "./history-links";
import { createLocalMessageId as createLocalMessageIdImpl } from "./message-id";
import type { UiState } from "./types";

export const createLocalMessageId = createLocalMessageIdImpl;
export const linkTrajectoryHistory = linkTrajectoryHistoryImpl;
export const linkFinishReasonToolCalls = linkFinishReasonToolCallsImpl;

type AgentHistoryItem = HistoryItem<OctoIR>;
type AgentHistory = readonly AgentHistoryItem[];
type MutableAgentHistory = AgentHistoryItem[];
type PendingRejectedToolCall = NonNullable<UiState["pendingRejectedToolCall"]>;

function historyItemJson(item: AgentHistoryItem): string {
	return JSON.stringify(item);
}

function firstActiveCheckpoint(
	history: AgentHistory,
): AgentHistoryItem | undefined {
	let index = 0;
	while (index < history.length) {
		const item = history[index];
		if (item?.type === "llm-ir" && item.ir.role === "checkpoint") {
			return item;
		}
		index += 1;
	}
	return undefined;
}

function appendHistoryFrom(
	baseHistory: AgentHistory,
	finishHistory: AgentHistory,
	finishStart: number,
): MutableAgentHistory {
	const result = new Array<AgentHistoryItem>(
		baseHistory.length + finishHistory.length - finishStart,
	);
	let resultIndex = 0;
	let baseIndex = 0;
	while (baseIndex < baseHistory.length) {
		result[resultIndex] = baseHistory[baseIndex] as AgentHistoryItem;
		resultIndex += 1;
		baseIndex += 1;
	}
	let finishIndex = finishStart;
	while (finishIndex < finishHistory.length) {
		result[resultIndex] = finishHistory[finishIndex] as AgentHistoryItem;
		resultIndex += 1;
		finishIndex += 1;
	}
	return result;
}

export function mergeTrajectoryFinishHistory(
	baseHistory: AgentHistory,
	finishHistory: AgentHistory,
): MutableAgentHistory {
	const activeCheckpoint = firstActiveCheckpoint(baseHistory);
	const firstFinishItem = finishHistory[0];
	if (
		activeCheckpoint &&
		firstFinishItem?.type === "llm-ir" &&
		firstFinishItem.ir.role === "checkpoint" &&
		historyItemJson(activeCheckpoint) === historyItemJson(firstFinishItem)
	) {
		return appendHistoryFrom(baseHistory, finishHistory, 1);
	}
	return appendHistoryFrom(baseHistory, finishHistory, 0);
}

export function rejectedToolHistoryForUserMessage(
	history: AgentHistory,
	rejectedToolCall: UiState["pendingRejectedToolCall"],
	rejectedByUserMessageId: string,
): MutableAgentHistory {
	if (!rejectedToolCall) return [];
	const skipped = skippedCallsAfterRejectedTool(history, rejectedToolCall);
	const rejected: MutableAgentHistory = [];
	rejected[0] = {
		type: "llm-ir",
		ir: {
			role: "tool-reject",
			toolCall: rejectedToolCall,
			rejectedByUserMessageId,
		},
	};
	appendHistoryItems(rejected, skipped);
	return rejected;
}

const SKIPPED_AFTER_REJECT_REASON =
	"A previous tool call was rejected, so this tool was skipped";

function skippedCallsAfterRejectedTool(
	history: AgentHistory,
	rejectedToolCall: PendingRejectedToolCall,
): MutableAgentHistory {
	let toolCalls: Extract<OctoIR, { role: "assistant" }>["toolCalls"];
	let historyIndex = history.length - 1;
	while (historyIndex >= 0) {
		const item = history[historyIndex];
		if (
			item?.type === "llm-ir" &&
			item.ir.role === "assistant" &&
			item.ir.toolCalls != null
		) {
			toolCalls = item.ir.toolCalls;
			break;
		}
		historyIndex -= 1;
	}
	if (toolCalls === undefined) return [];

	let skipped: MutableAgentHistory | undefined;
	let writeIndex = 0;
	let index = 0;
	while (index < toolCalls.length) {
		const call = toolCalls[index];
		index += 1;
		if (skipped !== undefined) {
			if (call?.type !== "tool-call") continue;
			skipped[writeIndex] = {
				type: "llm-ir",
				ir: {
					role: "tool-skip-output",
					toolCall: call,
					reason: SKIPPED_AFTER_REJECT_REASON,
				},
			};
			writeIndex += 1;
			continue;
		}
		if (
			call?.type === "tool-call" &&
			call.toolCallId === rejectedToolCall.toolCallId
		) {
			skipped = [];
		}
	}
	return skipped ?? [];
}

export function userMessageContent(
	query: string,
	images: ImageInfo[] | undefined,
): Extract<OctoIR, { role: "user" }>["content"] {
	const content: Extract<OctoIR, { role: "user" }>["content"] = [
		{ type: "text", content: query },
	];
	if (images === undefined) return content;
	let index = 0;
	let writeIndex = content.length;
	while (index < images.length) {
		const image = images[index];
		if (image !== undefined) {
			content[writeIndex] = { type: "image", image };
			writeIndex += 1;
		}
		index += 1;
	}
	return content;
}

export function appendHistoryItems(
	target: HistoryItem<OctoIR>[],
	source: readonly HistoryItem<OctoIR>[],
): void {
	let index = 0;
	let writeIndex = target.length;
	while (index < source.length) {
		const item = source[index];
		if (item !== undefined) {
			target[writeIndex] = item;
			writeIndex += 1;
		}
		index += 1;
	}
}
