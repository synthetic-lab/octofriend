import { describe, expect, it } from "bun:test";
import { App, terminalUnchainedNotification } from "../../app/shell.tsx";

describe("terminal app shell", () => {
	it("exports the terminal app component", () => {
		expect(App).toBeFunction();
	});

	it("formats unchained-mode notifications", () => {
		expect(terminalUnchainedNotification(true)).toBe(
			"Octo runs edits and shell commands automatically",
		);
		expect(terminalUnchainedNotification(false)).toBe(
			"Octo asks permission before running edits or shell commands",
		);
	});
});
