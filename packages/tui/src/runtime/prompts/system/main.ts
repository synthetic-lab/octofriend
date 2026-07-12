import type { Config } from "../../config/schemas.ts";
import type { Transport } from "../../workspace/common.ts";

export type SystemPromptBuildParams = {
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

export type SystemPromptBuilder = (
	params: SystemPromptBuildParams,
) => Promise<{ prompt: string }>;

export async function systemPrompt({
	config,
	transport,
	systemPromptBuild,
}: {
	config: Config;
	transport: Transport;
	signal: AbortSignal;
	systemPromptBuild: SystemPromptBuilder;
}) {
	const result = await systemPromptBuild({
		userName: config.yourName,
		workingDirectory: transport.cwd,
		mcpPrompt: "",
	});
	return result.prompt;
}
