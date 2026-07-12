import { describe, expect, it } from "bun:test";
import {
	matchingSlashCommands,
	projectInitializationPrompt,
} from "../../src/shell/slash-commands.ts";

describe("slash command tooltip matching", () => {
	it("returns no commands for ordinary input", () => {
		expect(matchingSlashCommands("hello")).toEqual([]);
	});

	it("lists all commands for a slash", () => {
		expect(matchingSlashCommands("/").map((command) => command.name)).toEqual([
			"/help",
			"/init",
			"/clear",
			"/compact",
			"/metrics",
			"/model",
			"/quit",
		]);
	});

	it("filters by the current command token", () => {
		expect(matchingSlashCommands("/he")).toEqual([
			{ name: "/help", description: "Show available slash commands" },
		]);
	});

	it("builds a project initialization turn with optional instructions", () => {
		expect(projectInitializationPrompt("/init")).toContain(
			"create or update OCTO.md",
		);
		expect(projectInitializationPrompt("/init focus on Rust tests")).toContain(
			"Additional user instructions: focus on Rust tests",
		);
	});
});
