export type AgentdInitializeResult = {
	serverInfo: {
		name: string;
		version: string;
	};
	capabilities: {
		renderModels: boolean;
	};
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
	if (!isRecord(value)) return false;
	return Object.values(value).every((entry) => typeof entry === "string");
}

export function isAgentdInitializeResult(
	value: unknown,
): value is AgentdInitializeResult {
	if (!isRecord(value)) return false;
	const serverInfo = value["serverInfo"];
	const capabilities = value["capabilities"];
	if (!isStringRecord(serverInfo)) return false;
	if (!isRecord(capabilities)) return false;
	return (
		typeof serverInfo["name"] === "string" &&
		typeof serverInfo["version"] === "string" &&
		typeof capabilities["renderModels"] === "boolean"
	);
}
