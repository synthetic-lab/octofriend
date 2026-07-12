import type { OctoIR } from "../runtime/agent/ir/main.ts";
import type { HistoryItem } from "../runtime/history/main.ts";

export type ConversationSessionHistory = HistoryItem<OctoIR>[];

export type SaveConversationSession = (
	sessionId: string,
	history: ConversationSessionHistory,
) => Promise<void>;
