export type AgentdToolRenderDetail = {
	label: string;
	value: string;
};

export type AgentdToolRenderModel = {
	kind: string;
	title: string;
	subject?: string | null;
	details: AgentdToolRenderDetail[];
	filePreview?: unknown;
	diffPreview?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAgentdToolRenderDetail(
	value: unknown,
): value is AgentdToolRenderDetail {
	return (
		isRecord(value) &&
		typeof value["label"] === "string" &&
		typeof value["value"] === "string"
	);
}

export function isAgentdToolRenderModel(
	value: unknown,
): value is AgentdToolRenderModel {
	if (!isRecord(value)) return false;
	const subject = value["subject"];
	const details = value["details"];
	return (
		typeof value["kind"] === "string" &&
		typeof value["title"] === "string" &&
		(subject === undefined ||
			subject === null ||
			typeof subject === "string") &&
		Array.isArray(details) &&
		details.every(isAgentdToolRenderDetail)
	);
}
