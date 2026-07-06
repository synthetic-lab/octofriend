export type AgentdProviderShortcut =
	| "a"
	| "b"
	| "c"
	| "d"
	| "e"
	| "f"
	| "g"
	| "i"
	| "m"
	| "n"
	| "o"
	| "p"
	| "q"
	| "r"
	| "s"
	| "t"
	| "u"
	| "v"
	| "w"
	| "x"
	| "y"
	| "z";

export type AgentdImageModalityConfig = {
	enabled: boolean;
	maxSizeMB: number;
	acceptedMimeTypes: string[];
};

export type AgentdMultimodalConfig = {
	image?: AgentdImageModalityConfig | null;
};

export type AgentdProviderModelConfig = {
	model: string;
	nickname: string;
	context: number;
	reasoning?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
	thinkingBudgetTokens?: number;
	modalities?: AgentdMultimodalConfig;
};

export type AgentdProviderConfig = {
	shortcut: AgentdProviderShortcut;
	type: "standard" | "openai-responses" | "anthropic" | "gemini";
	name: string;
	envVar: string;
	baseUrl: string;
	apiKeyUrl: string;
	models: AgentdProviderModelConfig[];
	testModel: string;
};

export type AgentdModelProviderCatalogResult = {
	providers: Record<string, AgentdProviderConfig>;
	syntheticProviderKey: string;
	defaultMultimodalImageModelExample: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProviderShortcut(value: unknown): value is AgentdProviderShortcut {
	return (
		typeof value === "string" &&
		value.length === 1 &&
		"abcdefghijklmnopqrstuvwxyz".includes(value) &&
		value !== "h" &&
		value !== "j" &&
		value !== "k" &&
		value !== "l"
	);
}

function isProviderType(value: unknown): value is AgentdProviderConfig["type"] {
	return (
		value === "standard" ||
		value === "openai-responses" ||
		value === "anthropic" ||
		value === "gemini"
	);
}

function isReasoning(
	value: unknown,
): value is "none" | "minimal" | "low" | "medium" | "high" | "xhigh" {
	return (
		value === "none" ||
		value === "minimal" ||
		value === "low" ||
		value === "medium" ||
		value === "high" ||
		value === "xhigh"
	);
}

function isImageModalityConfig(
	value: unknown,
): value is AgentdImageModalityConfig {
	return (
		isRecord(value) &&
		typeof value["enabled"] === "boolean" &&
		typeof value["maxSizeMB"] === "number" &&
		Array.isArray(value["acceptedMimeTypes"]) &&
		value["acceptedMimeTypes"].every((entry) => typeof entry === "string")
	);
}

function isMultimodalConfig(value: unknown): value is AgentdMultimodalConfig {
	if (!isRecord(value)) return false;
	const image = value["image"];
	return image === undefined || image === null || isImageModalityConfig(image);
}

function isProviderModelConfig(
	value: unknown,
): value is AgentdProviderModelConfig {
	if (!isRecord(value)) return false;
	const reasoning = value["reasoning"];
	const thinkingBudgetTokens = value["thinkingBudgetTokens"];
	const modalities = value["modalities"];
	return (
		typeof value["model"] === "string" &&
		typeof value["nickname"] === "string" &&
		typeof value["context"] === "number" &&
		(reasoning === undefined || isReasoning(reasoning)) &&
		(thinkingBudgetTokens === undefined ||
			typeof thinkingBudgetTokens === "number") &&
		(modalities === undefined || isMultimodalConfig(modalities))
	);
}

function isProviderConfig(value: unknown): value is AgentdProviderConfig {
	return (
		isRecord(value) &&
		isProviderShortcut(value["shortcut"]) &&
		isProviderType(value["type"]) &&
		typeof value["name"] === "string" &&
		typeof value["envVar"] === "string" &&
		typeof value["baseUrl"] === "string" &&
		typeof value["apiKeyUrl"] === "string" &&
		Array.isArray(value["models"]) &&
		value["models"].every(isProviderModelConfig) &&
		typeof value["testModel"] === "string"
	);
}

export function isAgentdModelProviderCatalogResult(
	value: unknown,
): value is AgentdModelProviderCatalogResult {
	if (!(isRecord(value) && isRecord(value["providers"]))) return false;
	return (
		Object.values(value["providers"]).every(isProviderConfig) &&
		typeof value["syntheticProviderKey"] === "string" &&
		typeof value["defaultMultimodalImageModelExample"] === "string"
	);
}
