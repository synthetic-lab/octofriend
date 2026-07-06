export type AgentdAutofixUsage = {
	input: number;
	output: number;
};

export type AgentdAutofixJsonParams = {
	baseUrl: string;
	apiKey: string;
	model: string;
	brokenJson: string;
};

export type AgentdAutofixJsonResult =
	| {
			success: true;
			fixed: unknown;
			usage?: AgentdAutofixUsage;
	  }
	| {
			success: false;
			usage?: AgentdAutofixUsage;
	  };

export type AgentdAutofixEditParams = {
	baseUrl: string;
	apiKey: string;
	model: string;
	file: string;
	edit: {
		search: string;
		replace: string;
	};
};

export type AgentdAutofixEditResult =
	| {
			success: true;
			search: string;
			usage?: AgentdAutofixUsage;
	  }
	| {
			success: false;
			usage?: AgentdAutofixUsage;
	  };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAutofixUsage(value: unknown): value is AgentdAutofixUsage {
	return (
		isRecord(value) &&
		typeof value["input"] === "number" &&
		typeof value["output"] === "number"
	);
}

function hasValidOptionalUsage(value: Record<string, unknown>): boolean {
	return value["usage"] === undefined || isAutofixUsage(value["usage"]);
}

export function isAgentdAutofixJsonResult(
	value: unknown,
): value is AgentdAutofixJsonResult {
	if (!isRecord(value) || typeof value["success"] !== "boolean") return false;
	if (!hasValidOptionalUsage(value)) return false;
	if (value["success"] === true) return "fixed" in value;
	return true;
}

export function isAgentdAutofixEditResult(
	value: unknown,
): value is AgentdAutofixEditResult {
	if (!isRecord(value) || typeof value["success"] !== "boolean") return false;
	if (!hasValidOptionalUsage(value)) return false;
	if (value["success"] === true) return typeof value["search"] === "string";
	return true;
}
