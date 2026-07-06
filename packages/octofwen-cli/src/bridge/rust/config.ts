export type AgentdConfigParams = {
	config: unknown;
};

export type AgentdConfigResult = {
	config: unknown;
};

export type AgentdConfigKeyForModelParams = {
	model: unknown;
	config?: unknown;
};

export type AgentdConfigKeyForBaseUrlParams = {
	baseUrl: string;
	config?: unknown;
};

export type AgentdConfigSearchParams = {
	config?: unknown;
};

export type AgentdConfigWriteKeyParams = {
	baseUrl: string;
	apiKey: string;
};

export type AgentdConfigMergeEnvVarParams = {
	config: unknown;
	model: unknown;
	apiEnvVar: string;
};

export type AgentdConfigMergeAutofixEnvVarParams = {
	config: unknown;
	key: "diffApply" | "fixJson";
	model: unknown;
	apiEnvVar: string;
};

export type AgentdConfigKeyResult =
	| { ok: true; key: string }
	| {
			ok: false;
			error:
				| { type: "missing"; message: string }
				| { type: "invalid"; message: string }
				| {
						type: "command_failed";
						message: string;
						exitCode?: number;
						stderr?: string;
				  };
	  };

export type AgentdConfigKeyResultEnvelope = {
	result: AgentdConfigKeyResult;
};

export type AgentdConfigSearchResult = {
	search: { url: string; key: string } | null;
};

export type AgentdConfigHasExistingKeyResult = {
	hasExistingKey: boolean;
};

export type AgentdConfigWriteKeyResult = Record<string, never>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isConfigKeyResult(value: unknown): value is AgentdConfigKeyResult {
	if (!isRecord(value) || typeof value["ok"] !== "boolean") return false;
	if (value["ok"]) return typeof value["key"] === "string";
	const error = value["error"];
	if (!isRecord(error) || typeof error["message"] !== "string") return false;
	if (error["type"] === "missing" || error["type"] === "invalid") return true;
	return (
		error["type"] === "command_failed" &&
		(error["exitCode"] === undefined ||
			typeof error["exitCode"] === "number") &&
		(error["stderr"] === undefined || typeof error["stderr"] === "string")
	);
}

export function isAgentdConfigResult(
	value: unknown,
): value is AgentdConfigResult {
	return isRecord(value) && "config" in value;
}

export function isAgentdConfigKeyResultEnvelope(
	value: unknown,
): value is AgentdConfigKeyResultEnvelope {
	return isRecord(value) && isConfigKeyResult(value["result"]);
}

export function isAgentdConfigSearchResult(
	value: unknown,
): value is AgentdConfigSearchResult {
	if (!isRecord(value)) return false;
	if (value["search"] === null) return true;
	return (
		isRecord(value["search"]) &&
		typeof value["search"]["url"] === "string" &&
		typeof value["search"]["key"] === "string"
	);
}

export function isAgentdConfigHasExistingKeyResult(
	value: unknown,
): value is AgentdConfigHasExistingKeyResult {
	return isRecord(value) && typeof value["hasExistingKey"] === "boolean";
}

export function isAgentdConfigWriteKeyResult(
	value: unknown,
): value is AgentdConfigWriteKeyResult {
	return isRecord(value);
}
