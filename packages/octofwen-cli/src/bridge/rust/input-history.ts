export type AgentdInputHistoryLoadParams = {
	databasePath?: string;
	maxHistoryItems?: number;
};

export type AgentdInputHistoryAppendParams = AgentdInputHistoryLoadParams & {
	input: string;
};

export type AgentdInputHistoryResult = {
	history: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAgentdInputHistoryResult(
	value: unknown,
): value is AgentdInputHistoryResult {
	return (
		isRecord(value) &&
		Array.isArray(value["history"]) &&
		value["history"].every((item) => typeof item === "string")
	);
}
