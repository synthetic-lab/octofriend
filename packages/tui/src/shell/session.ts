import type { OctoIR } from "../runtime/agent/ir/main";
import type { HistoryItem } from "../runtime/history/main";

export type ConversationSessionHistory = HistoryItem<OctoIR>[];

export type SaveConversationSession = (
	sessionId: string,
	history: ConversationSessionHistory,
) => Promise<void>;
