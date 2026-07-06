export type AgentdOctoLowerParams = {
	messages: readonly unknown[];
	modalities?: unknown;
};

export type AgentdOctoLowerResult = {
	irs: unknown[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAgentdOctoLowerResult(
	value: unknown,
): value is AgentdOctoLowerResult {
	return isRecord(value) && Array.isArray(value["irs"]);
}
