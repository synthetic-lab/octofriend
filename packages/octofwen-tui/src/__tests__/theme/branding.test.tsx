import { describe, expect, it } from "bun:test";
import figlet from "figlet";
import { render } from "ink-testing-library";
import {
	getTerminalThemeColor,
	OCTOFWEN_HEADER_FONT,
	Octo,
	TerminalHeader,
} from "../../theme/branding.tsx";

function trimRightByLine(value: string): string {
	return value
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n");
}

describe("TerminalHeader", () => {
	it("renders the Octo/Friend figlet masthead with the product font", () => {
		const { lastFrame } = render(<TerminalHeader unchained={false} />);
		const output = trimRightByLine(lastFrame() || "");

		expect(output).toContain(
			trimRightByLine(figlet.textSync("Octo", { font: OCTOFWEN_HEADER_FONT })),
		);
		expect(output).toContain(
			trimRightByLine(
				figlet.textSync("Friend", { font: OCTOFWEN_HEADER_FONT }),
			),
		);
	});
});

describe("getTerminalThemeColor", () => {
	it("uses the standard brand color by default", () => {
		expect(getTerminalThemeColor(false)).toBe("#72946d");
	});

	it("uses the unchained brand color when unchained mode is active", () => {
		expect(getTerminalThemeColor(true)).toBe("#AA0A0A");
	});
});

describe("Octo", () => {
	it("renders the terminal assistant glyph", () => {
		const { lastFrame } = render(<Octo />);

		expect(lastFrame()).toBe("🐙");
	});
});
