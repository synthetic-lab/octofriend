import { create } from "zustand";
import { createHistoryActions } from "./history-actions.ts";
import { createMenuActions } from "./menu-state.ts";
import { createNotificationActions } from "./notifications.ts";
import { createAgentActions } from "./runner.ts";
import { createToolActions } from "./tool-actions.ts";
import type { UiState } from "./types.ts";
import { createWhitelistActions } from "./whitelist.ts";

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
