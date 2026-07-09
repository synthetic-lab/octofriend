export type AgentdToolRunParams = AgentdToolRunBaseParams &
	AgentdToolRunContextParams;

type AgentdToolRunBaseParams = {
	toolName: string;
	cwd: string;
	toolCallId: string;
	toolCall: unknown;
	parsed: unknown;
	transport?: unknown;
};

type AgentdToolRunContextParams = {
	modelContext?: number;
	mcpServers?: unknown;
	lsp?: unknown;
	webSearch?: unknown;
	userName?: string;
	skills?: unknown;
};

export type AgentdToolContent =
	| { type: "text"; content: string }
	| { type: "image"; mimeType: string; data: string };

export type AgentdToolRunValue =
	| { type: "output"; content: AgentdToolContent[]; lines?: number | null }
	| { type: "invoke-subagent"; name: string }
	| { type: "custom-ir"; data: unknown };

export type AgentdToolRunResult =
	| { status: "completed"; result: AgentdToolRunValue }
	| { status: "error"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAgentdToolContent(value: unknown): value is AgentdToolContent {
	if (!isRecord(value)) return false;
	if (value["type"] === "text") return typeof value["content"] === "string";
	return (
		value["type"] === "image" &&
		typeof value["mimeType"] === "string" &&
		typeof value["data"] === "string"
	);
}

function isAgentdToolRunValue(value: unknown): value is AgentdToolRunValue {
	if (!isRecord(value)) return false;
	if (value["type"] === "output") {
		return (
			Array.isArray(value["content"]) &&
			value["content"].every(isAgentdToolContent) &&
			(value["lines"] === undefined ||
				value["lines"] === null ||
				typeof value["lines"] === "number")
		);
	}
	if (value["type"] === "invoke-subagent") {
		return typeof value["name"] === "string";
	}
	return value["type"] === "custom-ir" && "data" in value;
}

export function isAgentdToolRunResult(
	value: unknown,
): value is AgentdToolRunResult {
	if (!isRecord(value)) return false;
	if (value["status"] === "completed") {
		return isAgentdToolRunValue(value["result"]);
	}
	return value["status"] === "error" && typeof value["message"] === "string";
}
