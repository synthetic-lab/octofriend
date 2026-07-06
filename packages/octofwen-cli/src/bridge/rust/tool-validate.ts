export type AgentdToolValidateParams = {
	toolName: string;
	cwd: string;
	parsed: unknown;
};

export type AgentdToolValidateResult =
	| { status: "valid" }
	| { status: "error"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAgentdToolValidateResult(
	value: unknown,
): value is AgentdToolValidateResult {
	if (!isRecord(value)) return false;
	return (
		value["status"] === "valid" ||
		(value["status"] === "error" && typeof value["message"] === "string")
	);
}
