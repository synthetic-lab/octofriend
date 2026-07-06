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
				pendingRejectedToolCall: null,
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
				pendingRejectedToolCall: null,
				byteCount: 0,
				clearNonce: state.clearNonce + 1,
				modeData: { mode: "input", vimMode: "INSERT" },
			}));
		},

		rejectTool: (toolCall) => {
			set({
				pendingRejectedToolCall: toolCall,
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
