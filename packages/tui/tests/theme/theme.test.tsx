import { describe, expect, it } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import {
	CODE_GUTTER_COLOR,
	DIFF_ADDED_COLOR,
	DIFF_REMOVED_COLOR,
	TERMINAL_THEME_COLOR,
	TERMINAL_UNCHAINED_COLOR,
	TerminalThemeProvider,
	useTerminalThemeColor,
	useTerminalUnchained,
} from "../../src/theme/branding";

function ThemeProbe() {
	const color = useTerminalThemeColor();
	const unchained = useTerminalUnchained();
	return <Text>{`${color}:${unchained}`}</Text>;
}

describe("terminal theme colors", () => {
	it("exports the terminal UI color constants used by renderers", () => {
		expect(TERMINAL_THEME_COLOR).toBe("#72946d");
		expect(TERMINAL_UNCHAINED_COLOR).toBe("#AA0A0A");
		expect(DIFF_REMOVED_COLOR).toBe("#880808");
		expect(DIFF_ADDED_COLOR).toBe("#405e35");
		expect(CODE_GUTTER_COLOR).toBe("gray");
	});

	it("provides standard terminal color from React context by default", () => {
		const { lastFrame } = render(<ThemeProbe />);

		expect(lastFrame()).toBe(`${TERMINAL_THEME_COLOR}:false`);
	});

	it("provides unchained terminal color from React context", () => {
		const { lastFrame } = render(
			<TerminalThemeProvider unchained={true}>
				<ThemeProbe />
			</TerminalThemeProvider>,
		);

		expect(lastFrame()).toBe(`${TERMINAL_UNCHAINED_COLOR}:true`);
	});
});
