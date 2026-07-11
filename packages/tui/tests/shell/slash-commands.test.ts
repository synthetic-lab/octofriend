import { describe, expect, it } from "bun:test";
import { matchingSlashCommands } from "../../src/shell/slash-commands";

describe("slash command tooltip matching", () => {
	it("returns no commands for ordinary input", () => {
		expect(matchingSlashCommands("hello")).toEqual([]);
	});

	it("lists all commands for a slash", () => {
		expect(matchingSlashCommands("/").map((command) => command.name)).toEqual([
			"/help", "/clear", "/model", "/quit",
		]);
	});

	it("filters by the current command token", () => {
		expect(matchingSlashCommands("/he")).toEqual([
			{ name: "/help", description: "Show available slash commands" },
		]);
	});
});
