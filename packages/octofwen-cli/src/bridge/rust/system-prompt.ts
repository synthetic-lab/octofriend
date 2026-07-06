export type AgentdSystemPromptParams = {
	userName: string;
	workingDirectory?: string;
	directoryEntries?: Array<{
		entry: string;
		isDirectory: boolean;
	}>;
	mcpPrompt?: string;
	instructionPrompt?: string;
	instructionFiles?: Array<{
		path: string;
		target: "CLAUDE.md" | "AGENTS.md" | ".agents/AGENTS.md";
		contents: string;
	}>;
};

export type AgentdSystemPromptResult = {
	prompt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAgentdSystemPromptResult(
	value: unknown,
): value is AgentdSystemPromptResult {
	return isRecord(value) && typeof value["prompt"] === "string";
}
