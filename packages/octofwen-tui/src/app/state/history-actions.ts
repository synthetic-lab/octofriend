import type {
	OctoIR,
	OctoToolCall,
} from "../../internal/octo-agent-ir/main.ts";
import type { AppStateGet, AppStateSet, RunArgs, UiState } from "./types.ts";

export function createHistoryActions(set: AppStateSet, get: AppStateGet) {
	return {
		setQuery: (query: string) => {
			set({ query });
		},

		setModelOverride: (model: string) => {
			set({
				modelOverride: model,
				history: [
					...get().history,
					{
						type: "notification",
						content: `Model: ${model}`,
					},
				],
			});
		},

		clearHistory: () => {
			// Abort any ongoing responses to avoid polluting the new cleared state.
			const { abortResponse } = get();
			abortResponse();

			set((state) => ({
				history: [],
				lastUserPromptIndex: null,
				byteCount: 0,
				clearNonce: state.clearNonce + 1,
			}));
		},

		editAndRetryFrom: (
			mode: "request-error" | "compaction-error",
			_args: RunArgs,
		) => {
			if (get().modeData.mode !== mode) {
				return;
			}

			const { history, lastUserPromptIndex } = get();

			if (lastUserPromptIndex === null) {
				set({
					query: "",
					byteCount: 0,
					modeData: { mode: "input", vimMode: "INSERT" },
				});
				return;
			}

			const lastUserItem = history[lastUserPromptIndex];
			if (lastUserItem?.type !== "llm-ir" || lastUserItem.ir.role !== "user") {
				set({
					query: "",
					byteCount: 0,
					modeData: { mode: "input", vimMode: "INSERT" },
				});
				return;
			}

			const filteredHistory = history.slice(0, lastUserPromptIndex);
			const textPart = lastUserItem.ir.content.find(
				(
					part,
				): part is Extract<
					(typeof lastUserItem.ir.content)[number],
					{ type: "text" }
				> => part.type === "text",
			);
			set((state) => ({
				history: filteredHistory,
				query: textPart?.content ?? "",
				byteCount: 0,
				clearNonce: state.clearNonce + 1,
				modeData: { mode: "input", vimMode: "INSERT" },
			}));
		},

		rejectTool: (toolCall) => {
			const skippedCalls = skippedCallsAfterRejectedTool(
				get().history,
				toolCall,
			);
			set({
				history: [
					...get().history,
					{
						type: "llm-ir",
						ir: {
							role: "tool-reject",
							toolCall,
						},
					},
					...skippedCalls,
				],
				modeData: {
					mode: "input",
					vimMode: "INSERT",
				},
			});
		},
	} satisfies Pick<
		UiState,
		| "setQuery"
		| "setModelOverride"
		| "clearHistory"
		| "editAndRetryFrom"
		| "rejectTool"
	>;
}

type HistoryItem = UiState["history"][number];
type LlmHistoryItem = Extract<HistoryItem, { type: "llm-ir" }>;
type AssistantToolCallItem = LlmHistoryItem & {
	ir: Extract<OctoIR, { role: "assistant" }>;
};
type SkippedToolCallItem = { type: "llm-ir"; ir: OctoIR };

function skippedCallsAfterRejectedTool(
	history: HistoryItem[],
	rejectedToolCall: OctoToolCall,
): SkippedToolCallItem[] {
	const assistantItem = findLastAssistantToolCallItem(history);
	const toolCalls = assistantItem?.ir.toolCalls ?? [];
	const rejectedIndex = toolCalls.findIndex(
		(call) =>
			call.type === "tool-call" &&
			call.toolCallId === rejectedToolCall.toolCallId,
	);
	if (rejectedIndex < 0) return [];
	return toolCalls
		.slice(rejectedIndex + 1)
		.filter((call): call is OctoToolCall => call.type === "tool-call")
		.map((toolCall) => ({
			type: "llm-ir",
			ir: {
				role: "tool-skip-output",
				toolCall,
				reason: "A previous tool call was rejected, so this tool was skipped",
			},
		}));
}

function findLastAssistantToolCallItem(
	history: HistoryItem[],
): AssistantToolCallItem | undefined {
	return history.findLast(
		(item): item is AssistantToolCallItem =>
			item.type === "llm-ir" &&
			item.ir.role === "assistant" &&
			item.ir.toolCalls != null,
	);
}
