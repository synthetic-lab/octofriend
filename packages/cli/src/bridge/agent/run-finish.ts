export type AgentdTrajectoryFinishParams =
	| {
			irs: readonly unknown[];
			assistantMessage: unknown;
	  }
	| {
			irs: readonly unknown[];
			toolCalls: readonly unknown[];
			retryIrs: readonly unknown[];
	  }
	| {
			irs: readonly unknown[];
			toolCalls: readonly unknown[];
			validationResults: readonly AgentdToolValidationRetryResult[];
	  }
	| {
			irs: readonly unknown[];
			compilerError: {
				type: string;
				requestError: string;
				curl: string;
			};
	  }
	| {
			irs: readonly unknown[];
			headers: Record<string, string>;
	  }
	| {
			irs: readonly unknown[];
			buffer: { content?: string; reasoning?: string; tool?: string };
	  };

export type AgentdToolValidationRetryResult =
	| { status: "valid" }
	| { status: "error"; message: string; aborted: boolean };

export type AgentdTrajectoryFinishResult = {
	irs: unknown[];
	reason:
		| { type: "needs-response" }
		| { type: "request-tool"; toolCalls: unknown[] }
		| { type: "request-error"; requestError: string; curl: string }
		| { type: "auth-error"; requestError: string; curl: string }
		| { type: "payment-error"; requestError: string; curl: string }
		| { type: "rate-limit-error"; requestError: string; curl: string };
	events: Array<
		| { type: "retry-tool"; irs: unknown[] }
		| { type: "quota-updated"; quota: unknown }
	>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTrajectoryFinishReason(
	value: unknown,
): value is AgentdTrajectoryFinishResult["reason"] {
	if (!isRecord(value)) return false;
	if (value["type"] === "needs-response") return true;
	if (value["type"] === "request-tool")
		return Array.isArray(value["toolCalls"]);
	return (
		(value["type"] === "request-error" ||
			value["type"] === "auth-error" ||
			value["type"] === "payment-error" ||
			value["type"] === "rate-limit-error") &&
		typeof value["requestError"] === "string" &&
		typeof value["curl"] === "string"
	);
}

function isTrajectoryFinishEvent(
	value: unknown,
): value is AgentdTrajectoryFinishResult["events"][number] {
	if (!isRecord(value)) return false;
	if (value["type"] === "retry-tool") return Array.isArray(value["irs"]);
	return value["type"] === "quota-updated" && "quota" in value;
}

export function isAgentdTrajectoryFinishResult(
	value: unknown,
): value is AgentdTrajectoryFinishResult {
	return (
		isRecord(value) &&
		Array.isArray(value["irs"]) &&
		isTrajectoryFinishReason(value["reason"]) &&
		Array.isArray(value["events"]) &&
		value["events"].every(isTrajectoryFinishEvent)
	);
}
