export type SlashCommand = {
	name: string;
	description: string;
};

export const SLASH_COMMANDS: readonly SlashCommand[] = [
	{ name: "/help", description: "Show available slash commands" },
	{ name: "/clear", description: "Clear the conversation history" },
	{ name: "/model", description: "Choose or change the active model" },
	{ name: "/quit", description: "Exit Octo" },
];

export function slashCommandMatches(command: SlashCommand, query: string): boolean {
	const token = query.trim().split(/\s/u, 1)[0] ?? "";
	return token.startsWith("/") && command.name.startsWith(token);
}

export function matchingSlashCommands(query: string): readonly SlashCommand[] {
	if (!query.trimStart().startsWith("/")) return [];
	return SLASH_COMMANDS.filter((command) => slashCommandMatches(command, query));
}

export function slashCommandName(query: string): string | null {
	const token = query.trim().split(/\s/u, 1)[0] ?? "";
	return token.startsWith("/") ? token : null;
}

export function isSlashCommand(query: string): boolean {
	return slashCommandName(query) !== null;
}
