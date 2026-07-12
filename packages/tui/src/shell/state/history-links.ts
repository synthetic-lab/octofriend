import type { OctoIR } from "../../runtime/agent/ir/main.ts";
import type {
	HistoryItem,
	LlmHistoryItem,
} from "../../runtime/history/main.ts";
import type { Finish } from "../../runtime/run-log/types.ts";
import { createLocalMessageId } from "./message-id.ts";
import type { UiState } from "./types.ts";

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

type AgentHistoryItem = HistoryItem<OctoIR>;
type AgentHistory = readonly AgentHistoryItem[];
type MutableAgentHistory = AgentHistoryItem[];
type PendingRejectedToolCall = NonNullable<UiState["pendingRejectedToolCall"]>;
type PendingRejectedToolCallsById = Map<string, PendingRejectedToolCall>;
type PendingRejectedToolCallIds = Set<string>;
type AssistantToolCallIds = Map<string, string>;

type LinkableAssistantIR = Omit<
	Extract<OctoIR, { role: "assistant" }>,
	"messageId"
> & { messageId?: string };
type LinkableOctoIR = OctoIR | LinkableAssistantIR;
type LinkableHistoryItem =
	| Exclude<AgentHistoryItem, LlmHistoryItem<OctoIR>>
	| LlmHistoryItem<LinkableOctoIR>;

function linkedAssistantItem(
	item: LlmHistoryItem<LinkableOctoIR>,
	ir: Extract<OctoIR, { role: "assistant" }> & Record<string, unknown>,
	assistantByToolCallId: AssistantToolCallIds,
): AgentHistoryItem {
	const messageId =
		typeof ir["messageId"] === "string"
			? ir["messageId"]
			: createLocalMessageId("assistant");
	let toolCalls = ir.toolCalls;
	if (Array.isArray(ir.toolCalls)) {
		toolCalls = new Array<NonNullable<typeof ir.toolCalls>[number]>(
			ir.toolCalls.length,
		);
		let index = 0;
		while (index < ir.toolCalls.length) {
			const linkedToolCall = linkToolCallToAssistant(
				ir.toolCalls[index],
				messageId,
			) as NonNullable<typeof ir.toolCalls>[number];
			const toolCallId = toolCallIdFrom(linkedToolCall);
			if (toolCallId) assistantByToolCallId.set(toolCallId, messageId);
			toolCalls[index] = linkedToolCall;
			index += 1;
		}
	}
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
	assistantByToolCallId: AssistantToolCallIds,
): AgentHistoryItem {
	const toolCall = ir.toolCall;
	const existingAssistantMessageId = assistantMessageIdFromToolCall(toolCall);
	const toolCallId = toolCallIdFrom(toolCall);
	const assistantMessageId =
		existingAssistantMessageId ??
		(toolCallId ? assistantByToolCallId.get(toolCallId) : null);
	if (!assistantMessageId) return item as AgentHistoryItem;
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
): MutableAgentHistory {
	const assistantByToolCallId: AssistantToolCallIds = new Map();
	const linked: MutableAgentHistory = [];
	let index = 0;
	let writeIndex = 0;
	while (index < history.length) {
		const item = history[index];
		if (item === undefined) {
			index += 1;
			continue;
		}
		if (item.type === "llm-ir") {
			const ir = item.ir as OctoIR & Record<string, unknown>;
			if (ir.role === "assistant") {
				linked[writeIndex] = linkedAssistantItem(
					item,
					ir,
					assistantByToolCallId,
				);
			} else if (isToolResultLikeRole(ir.role)) {
				linked[writeIndex] = linkedToolResultItem(
					item,
					ir,
					assistantByToolCallId,
				);
			} else {
				linked[writeIndex] = item as AgentHistoryItem;
			}
		} else {
			linked[writeIndex] = item;
		}
		writeIndex += 1;
		index += 1;
	}
	return linked;
}

function linkedToolCallsById(
	history: AgentHistory,
	requestedToolCalls: readonly PendingRejectedToolCall[],
): PendingRejectedToolCallsById | undefined {
	if (requestedToolCalls.length === 0) return undefined;
	const remaining = requestedToolCallIds(requestedToolCalls);
	let linked: PendingRejectedToolCallsById | undefined;
	let historyIndex = history.length - 1;
	while (historyIndex >= 0 && remaining.size > 0) {
		const item = history[historyIndex];
		if (item?.type === "llm-ir" && item.ir.role === "assistant") {
			linked = linkRequestedToolCalls(item.ir.toolCalls, remaining, linked);
		}
		historyIndex -= 1;
	}
	return linked;
}

function requestedToolCallIds(
	requestedToolCalls: readonly PendingRejectedToolCall[],
): PendingRejectedToolCallIds {
	const remaining = new Set<string>();
	let requestIndex = 0;
	while (requestIndex < requestedToolCalls.length) {
		const toolCall = requestedToolCalls[requestIndex];
		if (toolCall !== undefined) remaining.add(toolCall.toolCallId);
		requestIndex += 1;
	}
	return remaining;
}

function linkRequestedToolCalls(
	toolCalls: Extract<OctoIR, { role: "assistant" }>["toolCalls"],
	remaining: PendingRejectedToolCallIds,
	linked: PendingRejectedToolCallsById | undefined,
): PendingRejectedToolCallsById | undefined {
	let linkedMap = linked;
	let toolIndex = toolCalls?.length ?? 0;
	while (toolIndex > 0 && remaining.size > 0) {
		toolIndex -= 1;
		const toolCall = toolCalls?.[toolIndex];
		if (toolCall?.type !== "tool-call") continue;
		if (!remaining.delete(toolCall.toolCallId)) continue;
		linkedMap ??= new Map<string, PendingRejectedToolCall>();
		linkedMap.set(toolCall.toolCallId, toolCall);
	}
	return linkedMap;
}

export function linkFinishReasonToolCalls(
	finishReason: Finish["reason"],
	history: AgentHistory,
): Finish["reason"] {
	if (
		finishReason.type !== "request-tool" ||
		finishReason.toolCalls.length === 0
	) {
		return finishReason;
	}
	const linkedToolCalls = linkedToolCallsById(history, finishReason.toolCalls);
	if (linkedToolCalls === undefined) return finishReason;
	const toolCalls: typeof finishReason.toolCalls = [];
	let index = 0;
	let writeIndex = 0;
	while (index < finishReason.toolCalls.length) {
		const toolCall = finishReason.toolCalls[index];
		if (toolCall !== undefined) {
			toolCalls[writeIndex] =
				linkedToolCalls.get(toolCall.toolCallId) ?? toolCall;
			writeIndex += 1;
		}
		index += 1;
	}
	return {
		...finishReason,
		toolCalls,
	};
}
