export type AgentdDiscoveredSkill = {
	name: string;
	description: string;
	license?: string | null;
	compatibility?: string | null;
	metadata: Record<string, string>;
	instructions: string;
	path: string;
	skillFilePath: string;
};

export type AgentdSkillDiscoverParams = {
	cwd: string;
	home: string;
	configuredSkillPaths: string[];
};

export type AgentdSkillDiscoverResult = {
	skills: AgentdDiscoveredSkill[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return (
		isRecord(value) &&
		Object.values(value).every((item) => typeof item === "string")
	);
}

function isAgentdDiscoveredSkill(
	value: unknown,
): value is AgentdDiscoveredSkill {
	return (
		isRecord(value) &&
		typeof value["name"] === "string" &&
		typeof value["description"] === "string" &&
		(value["license"] === undefined ||
			value["license"] === null ||
			typeof value["license"] === "string") &&
		(value["compatibility"] === undefined ||
			value["compatibility"] === null ||
			typeof value["compatibility"] === "string") &&
		isStringRecord(value["metadata"]) &&
		typeof value["instructions"] === "string" &&
		typeof value["path"] === "string" &&
		typeof value["skillFilePath"] === "string"
	);
}

export function isAgentdSkillDiscoverResult(
	value: unknown,
): value is AgentdSkillDiscoverResult {
	return (
		isRecord(value) &&
		Array.isArray(value["skills"]) &&
		value["skills"].every(isAgentdDiscoveredSkill)
	);
}
