export type AgentdCompactionDecisionParams = {
	maxContextWindow: number;
	messages: readonly unknown[];
};

export type AgentdCompactionDecisionResult = {
	shouldCompact: boolean;
	estimatedTokens: number;
	maxAllowedTokens: number;
};

export type AgentdCompactionPrepareParams = {
	messages: readonly unknown[];
};

export type AgentdCompactionPrepareResult = {
	messages: unknown[];
};

export type AgentdCompactionCheckpointContentParams = {
	output: unknown;
};

export type AgentdCompactionCheckpointContentResult =
	| {
			status: "success";
			content: unknown[];
	  }
	| {
			status: "empty";
			message: string;
	  };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAgentdCompactionDecisionResult(
	value: unknown,
): value is AgentdCompactionDecisionResult {
	return (
		isRecord(value) &&
		typeof value["shouldCompact"] === "boolean" &&
		typeof value["estimatedTokens"] === "number" &&
		typeof value["maxAllowedTokens"] === "number"
	);
}

export function isAgentdCompactionPrepareResult(
	value: unknown,
): value is AgentdCompactionPrepareResult {
	return isRecord(value) && Array.isArray(value["messages"]);
}

export function isAgentdCompactionCheckpointContentResult(
	value: unknown,
): value is AgentdCompactionCheckpointContentResult {
	if (!isRecord(value)) return false;
	if (value["status"] === "success") return Array.isArray(value["content"]);
	if (value["status"] === "empty") return typeof value["message"] === "string";
	return false;
}
