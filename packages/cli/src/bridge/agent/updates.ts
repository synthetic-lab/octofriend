export type AgentdUpdateNotificationsParams = {
	updatesPath?: string;
	databasePath?: string;
};

export type AgentdUpdateNotificationsReadResult = {
	updates: string | null;
};

export type AgentdUpdateNotificationsMarkSeenResult = Record<string, never>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAgentdUpdateNotificationsReadResult(
	value: unknown,
): value is AgentdUpdateNotificationsReadResult {
	return (
		isRecord(value) &&
		(typeof value["updates"] === "string" || value["updates"] === null)
	);
}

export function isAgentdUpdateNotificationsMarkSeenResult(
	value: unknown,
): value is AgentdUpdateNotificationsMarkSeenResult {
	return isRecord(value) && Object.keys(value).length === 0;
}
