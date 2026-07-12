import { create } from "zustand";
import { createAgentActions } from "./runner";
import { createHistoryActions } from "./history-actions";
import { createMenuActions } from "./menu-state";
import { createNotificationActions } from "./notifications";
import { createToolActions } from "./tool-actions";
import type { UiState } from "./types";
import { createWhitelistActions } from "./whitelist";

export const useAppStore = create<UiState>((set, get) => ({
	preMenuModeData: null,
	_notifyTimer: null,
	sessionAutoNotify: false,
	notifyOnce: false,
	modeData: {
		mode: "input" as const,
		vimMode: "INSERT" as const,
	},
	sessionId: crypto.randomUUID(),
	history: [],
	modelOverride: null,
	quotaData: null,
	byteCount: 0,
	query: "",
	clearNonce: 0,
	lastUserPromptIndex: null,
	pendingRejectedToolCall: null,
	whitelist: new Set<string>(),
	...createNotificationActions(set, get),
	...createAgentActions(set, get),
	...createHistoryActions(set, get),
	...createMenuActions(set, get),
	...createWhitelistActions(set, get),
	...createToolActions(set, get),
}));
