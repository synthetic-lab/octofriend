import type { AppStateGet, AppStateSet, RunArgs, UiState } from "./types";

type AppHistory = ReturnType<AppStateGet>["history"];
type AppHistoryItem = AppHistory[number];
type UserTextContent = Extract<
	AppHistoryItem,
	{ type: "llm-ir" }
>["ir"] extends infer Ir
	? Ir extends { role: "user"; content: infer Content }
		? Content
		: never
	: never;

function historyBeforeIndex(history: AppHistory, endIndex: number): AppHistory {
	const filtered: AppHistory = [];
	let index = 0;
	let writeIndex = 0;
	while (index < endIndex && index < history.length) {
		const item = history[index];
		if (item !== undefined) {
			filtered[writeIndex] = item;
			writeIndex += 1;
		}
		index += 1;
	}
	return filtered;
}

function historyWithNotification(
	history: AppHistory,
	content: string,
): AppHistory {
	const nextHistory = historyBeforeIndex(history, history.length);
	nextHistory[nextHistory.length] = { type: "notification", content };
	return nextHistory;
}

function firstUserTextContent(content: UserTextContent): string {
	let index = 0;
	while (index < content.length) {
		const part = content[index];
		if (part?.type === "text") return part.content;
		index += 1;
	}
	return "";
}

export function createHistoryActions(set: AppStateSet, get: AppStateGet) {
	return {
		setQuery: (query: string) => {
			set({ query });
		},

		setModelOverride: (model: string) => {
			set({
				modelOverride: model,
				history: historyWithNotification(get().history, `Model: ${model}`),
			});
		},

		clearHistory: () => {
			// Abort any ongoing responses to avoid polluting the new cleared state.
			const { abortResponse } = get();
			abortResponse();

			set((state) => ({
				sessionId: crypto.randomUUID(),
				history: [],
				lastUserPromptIndex: null,
				pendingRejectedToolCall: null,
				byteCount: 0,
				clearNonce: state.clearNonce + 1,
			}));
		},

		hydrateSession: (sessionId: string, history: AppHistory) => {
			set((state) => ({
				sessionId,
				history: historyBeforeIndex(history, history.length),
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

			const filteredHistory = historyBeforeIndex(history, lastUserPromptIndex);
			const query = firstUserTextContent(lastUserItem.ir.content);
			set((state) => ({
				history: filteredHistory,
				query,
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
		| "hydrateSession"
		| "editAndRetryFrom"
		| "rejectTool"
	>;
}
