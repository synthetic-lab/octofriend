export type AgentdTrajectoryArcParams = {
	cwd: string;
	apiKey: string;
	model: {
		type?: "standard" | "openai-responses" | "anthropic" | "gemini";
		baseUrl: string;
		model: string;
		context: number;
		reasoning?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
		thinkingBudgetTokens?: number;
		modalities?: unknown;
	};
	messages: readonly unknown[];
	config: {
		yourName: string;
		mcpServers?: unknown;
		search?: unknown;
		skills?: { paths?: readonly string[] };
		defaultApiKeyOverrides?: Record<string, string>;
		authModels?: Array<{ baseUrl: string; apiEnvVar?: string; auth?: unknown }>;
		fixJson?: {
			baseUrl: string;
			apiKey?: string;
			apiEnvVar?: string;
			auth?: unknown;
			model: string;
		};
	};
	aborted?: boolean;
};

export type AgentdTrajectoryArcEvent =
	| { type: "start-response" }
	| {
			type: "response-progress";
			buffer: {
				content?: string | null;
				reasoning?: string | null;
				tool?: string | null;
			};
			delta: { type: "content" | "reasoning" | "tool"; value: string };
	  }
	| { type: "start-compaction" }
	| {
			type: "compaction-progress";
			buffer: { content?: string | null; reasoning?: string | null };
			delta: { type: "content" | "reasoning"; value: string };
	  }
	| { type: "compaction-parsed"; checkpoint: unknown }
	| { type: "autofixing-json" }
	| { type: "autofixing-diff" }
	| { type: "quota-updated"; quota: unknown }
	| { type: "retry-tool"; irs: unknown[] }
	| { type: "token-usage"; input: number; output: number };

export type AgentdTrajectoryArcResult = {
	type: "finish";
	irs: unknown[];
	reason:
		| { type: "abort" }
		| { type: "needs-response" }
		| { type: "request-tool"; toolCalls: unknown[] }
		| { type: "request-error"; requestError: string; curl: string }
		| { type: "auth-error"; requestError: string; curl: string }
		| { type: "payment-error"; requestError: string; curl: string }
		| { type: "rate-limit-error"; requestError: string; curl: string }
		| { type: "compaction-error"; requestError: string; curl: string | null };
	events: AgentdTrajectoryArcEvent[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
	return value === undefined || value === null || typeof value === "string";
}

function isTrajectoryArcReason(
	value: unknown,
): value is AgentdTrajectoryArcResult["reason"] {
	if (!isRecord(value)) return false;
	if (value["type"] === "abort" || value["type"] === "needs-response") {
		return true;
	}
	if (value["type"] === "request-tool")
		return Array.isArray(value["toolCalls"]);
	if (value["type"] === "compaction-error") {
		return (
			typeof value["requestError"] === "string" &&
			(value["curl"] === null || typeof value["curl"] === "string")
		);
	}
	return (
		(value["type"] === "request-error" ||
			value["type"] === "auth-error" ||
			value["type"] === "payment-error" ||
			value["type"] === "rate-limit-error") &&
		typeof value["requestError"] === "string" &&
		typeof value["curl"] === "string"
	);
}

function isTrajectoryArcEvent(
	value: unknown,
): value is AgentdTrajectoryArcEvent {
	if (!isRecord(value)) return false;
	switch (value["type"]) {
		case "start-response":
		case "start-compaction":
		case "autofixing-json":
		case "autofixing-diff":
			return true;
		case "response-progress":
			return isProgressEvent(value, ["content", "reasoning", "tool"]);
		case "compaction-progress":
			return isProgressEvent(value, ["content", "reasoning"]);
		case "compaction-parsed":
			return "checkpoint" in value;
		case "quota-updated":
			return "quota" in value;
		case "retry-tool":
			return Array.isArray(value["irs"]);
		case "token-usage":
			return (
				typeof value["input"] === "number" &&
				typeof value["output"] === "number"
			);
		default:
			return false;
	}
}

function isProgressEvent(
	value: Record<string, unknown>,
	allowedDeltaTypes: readonly string[],
): boolean {
	if (!(isRecord(value["buffer"]) && isRecord(value["delta"]))) return false;
	const delta = value["delta"];
	return (
		allowedDeltaTypes.includes(String(delta["type"])) &&
		typeof delta["value"] === "string" &&
		isOptionalString(value["buffer"]["content"]) &&
		isOptionalString(value["buffer"]["reasoning"]) &&
		isOptionalString(value["buffer"]["tool"])
	);
}

export function isAgentdTrajectoryArcResult(
	value: unknown,
): value is AgentdTrajectoryArcResult {
	return (
		isRecord(value) &&
		value["type"] === "finish" &&
		Array.isArray(value["irs"]) &&
		isTrajectoryArcReason(value["reason"]) &&
		Array.isArray(value["events"]) &&
		value["events"].every(isTrajectoryArcEvent)
	);
}
