export type AgentdConversationHistoryKind =
	| "llm-ir"
	| "request-failed"
	| "compaction-failed"
	| "notification";

export type AgentdConversationHistoryEntry =
	| { kind: "llm-ir"; payload: string }
	| { kind: "request-failed" }
	| { kind: "compaction-failed" }
	| { kind: "notification"; payload: string };

export type AgentdConversationHistoryRecord = {
	id: number;
	kind: AgentdConversationHistoryKind;
	payload: string | null;
};

export type AgentdConversationHistoryParams = {
	databasePath?: string;
};

export type AgentdConversationHistoryAppendParams =
	AgentdConversationHistoryParams & {
		entry: AgentdConversationHistoryEntry;
	};

export type AgentdConversationHistoryAppendResult = Record<string, never>;

export type AgentdConversationHistoryRecordsResult = {
	records: AgentdConversationHistoryRecord[];
};

export type AgentdConversationHistoryLlmPayloadsResult = {
	payloads: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isConversationHistoryKind(
	value: unknown,
): value is AgentdConversationHistoryKind {
	return (
		value === "llm-ir" ||
		value === "request-failed" ||
		value === "compaction-failed" ||
		value === "notification"
	);
}

function isConversationHistoryRecord(
	value: unknown,
): value is AgentdConversationHistoryRecord {
	return (
		isRecord(value) &&
		typeof value["id"] === "number" &&
		isConversationHistoryKind(value["kind"]) &&
		(typeof value["payload"] === "string" || value["payload"] === null)
	);
}

export function isAgentdConversationHistoryAppendResult(
	value: unknown,
): value is AgentdConversationHistoryAppendResult {
	return isRecord(value) && Object.keys(value).length === 0;
}

export function isAgentdConversationHistoryRecordsResult(
	value: unknown,
): value is AgentdConversationHistoryRecordsResult {
	return (
		isRecord(value) &&
		Array.isArray(value["records"]) &&
		value["records"].every(isConversationHistoryRecord)
	);
}

export function isAgentdConversationHistoryLlmPayloadsResult(
	value: unknown,
): value is AgentdConversationHistoryLlmPayloadsResult {
	return (
		isRecord(value) &&
		Array.isArray(value["payloads"]) &&
		value["payloads"].every((payload) => typeof payload === "string")
	);
}

export type AgentdConversationSessionMetadata = {
	sessionId: string;
	cwd: string;
	launchJson: string;
	createdAt: number;
	updatedAt: number;
};

export type AgentdConversationSessionCreateParams = {
	databasePath: string;
	sessionId: string;
	cwd: string;
	launchJson: string;
	timestamp: number;
};

export type AgentdConversationSessionReplaceParams = {
	databasePath: string;
	records: AgentdConversationHistoryEntry[];
	parentRevisionId: number | null;
	timestamp: number;
};

export type AgentdConversationSessionEmptyResult = Record<string, never>;

export type AgentdConversationSessionReplaceResult = { revisionId: number };

export type AgentdConversationSessionLoadResult = {
	metadata: AgentdConversationSessionMetadata;
	revisionId: number | null;
	records: AgentdConversationHistoryRecord[];
};

export function isAgentdConversationSessionEmptyResult(
	value: unknown,
): value is AgentdConversationSessionEmptyResult {
	return isRecord(value) && Object.keys(value).length === 0;
}

export function isAgentdConversationSessionReplaceResult(
	value: unknown,
): value is AgentdConversationSessionReplaceResult {
	return isRecord(value) && typeof value["revisionId"] === "number";
}

export function isAgentdConversationSessionLoadResult(
	value: unknown,
): value is AgentdConversationSessionLoadResult {
	if (!isRecord(value) || !isRecord(value["metadata"])) return false;
	const metadata = value["metadata"];
	return (
		typeof metadata["sessionId"] === "string" &&
		typeof metadata["cwd"] === "string" &&
		typeof metadata["launchJson"] === "string" &&
		typeof metadata["createdAt"] === "number" &&
		typeof metadata["updatedAt"] === "number" &&
		(value["revisionId"] === null || typeof value["revisionId"] === "number") &&
		Array.isArray(value["records"]) &&
		value["records"].every(isConversationHistoryRecord)
	);
}
