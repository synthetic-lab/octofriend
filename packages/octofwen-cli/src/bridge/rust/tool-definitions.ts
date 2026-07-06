import type { AgentdDiscoveredSkill } from "./skill-discovery.ts";

export type AgentdToolDefinitionsParams = {
	hasMcpServers: boolean;
	hasWebSearch: boolean;
	skills: AgentdDiscoveredSkill[];
};

export type AgentdToolDefinition = {
	name: string;
	description: string;
	argumentsSchema: unknown;
};

export type AgentdToolDefinitionsResult = {
	tools: AgentdToolDefinition[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAgentdToolDefinition(value: unknown): value is AgentdToolDefinition {
	return (
		isRecord(value) &&
		typeof value["name"] === "string" &&
		typeof value["description"] === "string" &&
		"argumentsSchema" in value
	);
}

export function isAgentdToolDefinitionsResult(
	value: unknown,
): value is AgentdToolDefinitionsResult {
	return (
		isRecord(value) &&
		Array.isArray(value["tools"]) &&
		value["tools"].every(isAgentdToolDefinition)
	);
}
