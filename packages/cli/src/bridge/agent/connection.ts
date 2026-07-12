export type AgentdModelConnectionTestParams = {
	type?: "standard" | "openai-responses" | "anthropic" | "gemini";
	baseUrl: string;
	apiKey: string;
	model: string;
};

export type AgentdModelConnectionTestResult =
	| {
			valid: true;
			promptTokens?: number;
			completionTokens?: number;
			metadata: {
				name?: string;
				contextLength?: number;
			};
	  }
	| { valid: false };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isModelConnectionMetadata(value: unknown): boolean {
	if (!isRecord(value)) return false;
	return (
		(value["name"] === undefined || typeof value["name"] === "string") &&
		(value["contextLength"] === undefined ||
			typeof value["contextLength"] === "number") &&
		(value["models"] === undefined ||
			(Array.isArray(value["models"]) &&
				value["models"].every(
					(model) =>
						isRecord(model) &&
						typeof model["model"] === "string" &&
						typeof model["nickname"] === "string" &&
						(model["context"] === undefined ||
							typeof model["context"] === "number"),
				)))
	);
}

export function isAgentdModelConnectionTestResult(
	value: unknown,
): value is AgentdModelConnectionTestResult {
	if (!isRecord(value)) return false;
	if (value["valid"] === false) return true;
	return (
		value["valid"] === true &&
		(value["promptTokens"] === undefined ||
			typeof value["promptTokens"] === "number") &&
		(value["completionTokens"] === undefined ||
			typeof value["completionTokens"] === "number") &&
		isModelConnectionMetadata(value["metadata"])
	);
}

export type AgentdModelDiscoverParams = {
	type?: "standard" | "openai-responses" | "anthropic" | "gemini";
	baseUrl: string;
	apiKey: string;
};
export type AgentdModelDiscoverResult = {
	models: Array<{ id: string; name?: string; context_length?: number }>;
};

export function isAgentdModelDiscoverResult(
	value: unknown,
): value is AgentdModelDiscoverResult {
	return (
		isRecord(value) &&
		Array.isArray(value["models"]) &&
		value["models"].every(
			(model) => isRecord(model) && typeof model["id"] === "string",
		)
	);
}
