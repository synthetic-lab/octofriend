import { describe, expect, it } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { TerminalSizeProvider } from "../../layout/viewport.tsx";
import { MenuHeader, MenuPanel } from "../../menu/root.tsx";

describe("MenuHeader", () => {
	it("renders the terminal assistant glyph with a title", () => {
		const { lastFrame } = render(<MenuHeader title="Settings" />);

		const output = lastFrame() || "";
		expect(output).toContain("🐙");
		expect(output).toContain("Settings");
	});
	it("wraps body content to narrow terminal width", () => {
		const { lastFrame } = render(
			<TerminalSizeProvider size={{ width: 20, height: 10 }}>
				<MenuPanel
					title="Models"
					items={[{ label: "Fast", value: "fast" }]}
					onSelect={() => undefined}
				>
					<Text wrap="wrap">123456789012345678901234567890</Text>
				</MenuPanel>
			</TerminalSizeProvider>,
		);

		expect(lastFrame()).toContain("12345678901234567890\n");
		expect(lastFrame()).toContain("1234567890");
	});
});

describe("MenuPanel", () => {
	it("renders a titled select menu with optional body content", () => {
		const { lastFrame } = render(
			<MenuPanel
				title="Models"
				items={[
					{ label: "Fast", value: "fast" },
					{ label: "Careful", value: "careful" },
				]}
				onSelect={() => undefined}
			>
				<Text>Choose mode</Text>
			</MenuPanel>,
		);

		const output = lastFrame() || "";
		expect(output).toContain("🐙");
		expect(output).toContain("Models");
		expect(output).toContain("Choose mode");
		expect(output).toContain("Fast");
		expect(output).toContain("Careful");
	});
});
