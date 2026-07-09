export type AgentdSyntheticQuotaFetchParams = {
	apiKey: string;
};

export type AgentdSyntheticQuotaFetchResult = {
	quota: Record<string, unknown> | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAgentdSyntheticQuotaFetchResult(
	value: unknown,
): value is AgentdSyntheticQuotaFetchResult {
	return (
		isRecord(value) && (value["quota"] === null || isRecord(value["quota"]))
	);
}
