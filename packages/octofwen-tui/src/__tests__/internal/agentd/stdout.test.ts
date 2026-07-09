import { describe, expect, it } from "bun:test";
import { firstNonEmptyStdoutLine } from "../../../internal/agentd/stdout.ts";

describe("firstNonEmptyStdoutLine", () => {
	it("returns the first non-empty stdout line without splitting the full payload", () => {
		expect(firstNonEmptyStdoutLine('\n\t \n{"ok":true}\nignored')).toBe(
			'{"ok":true}',
		);
	});

	it("preserves carriage returns from CRLF lines for JSON.parse whitespace compatibility", () => {
		expect(firstNonEmptyStdoutLine('\r\n{"ok":true}\r\n')).toBe(
			'{"ok":true}\r',
		);
	});

	it("returns null when stdout has no non-whitespace line", () => {
		expect(firstNonEmptyStdoutLine("\n \t\r\n")).toBeNull();
	});

	it("treats Unicode whitespace-only lines as empty", () => {
		expect(firstNonEmptyStdoutLine("\u00a0\u2003\nvalue\n")).toBe("value");
	});
});
