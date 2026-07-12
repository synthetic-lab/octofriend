export type SlashCommand = {
	name: string;
	description: string;
};

const COMMAND_TOKEN_SEPARATOR = /\s/u;

export const SLASH_COMMANDS: readonly SlashCommand[] = [
	{ name: "/help", description: "Show available slash commands" },
	{ name: "/init", description: "Create or update project OCTO.md guidance" },
	{ name: "/clear", description: "Clear the conversation history" },
	{ name: "/compact", description: "Compact conversation history now" },
	{
		name: "/metrics",
		description: "Toggle per-request TTFT and token-rate stats",
	},
	{ name: "/model", description: "Choose or change the active model" },
	{ name: "/quit", description: "Exit Octo" },
];

export function slashCommandMatches(
	command: SlashCommand,
	query: string,
): boolean {
	const token = query.trim().split(COMMAND_TOKEN_SEPARATOR, 1)[0] ?? "";
	return token.startsWith("/") && command.name.startsWith(token);
}

export function matchingSlashCommands(query: string): readonly SlashCommand[] {
	if (!query.trimStart().startsWith("/")) return [];
	return SLASH_COMMANDS.filter((command) =>
		slashCommandMatches(command, query),
	);
}

export function slashCommandName(query: string): string | null {
	const token = query.trim().split(COMMAND_TOKEN_SEPARATOR, 1)[0] ?? "";
	return token.startsWith("/") ? token : null;
}

export function isSlashCommand(query: string): boolean {
	return slashCommandName(query) !== null;
}

export function projectInitializationPrompt(query: string): string {
	const instructions = query.trim().slice("/init".length).trim();
	const base =
		"Inspect this repository and create or update OCTO.md with concise, durable project guidance for future Octo sessions. Base it on authoritative repository documentation, configuration, source, and tests; preserve useful existing OCTO.md content and do not invent commands or conventions.";
	return instructions.length === 0
		? base
		: `${base} Additional user instructions: ${instructions}`;
}
