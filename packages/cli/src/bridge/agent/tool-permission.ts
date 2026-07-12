export type AgentdToolPermissionParams = {
	toolName: string;
	cwd: string;
	parsed: unknown;
};

export type AgentdToolPermissionResult = {
	whitelistKey: string;
	skipConfirmation: boolean;
	alwaysRequestPermission: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAgentdToolPermissionResult(
	value: unknown,
): value is AgentdToolPermissionResult {
	return (
		isRecord(value) &&
		typeof value["whitelistKey"] === "string" &&
		typeof value["skipConfirmation"] === "boolean" &&
		typeof value["alwaysRequestPermission"] === "boolean"
	);
}
