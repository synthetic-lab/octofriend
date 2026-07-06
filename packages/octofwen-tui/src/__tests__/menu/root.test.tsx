import { describe, expect, it } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { MenuHeader, MenuPanel } from "../../menu/root.tsx";

describe("MenuHeader", () => {
	it("renders the terminal assistant glyph with a title", () => {
		const { lastFrame } = render(<MenuHeader title="Settings" />);

		const output = lastFrame() || "";
		expect(output).toContain("🐙");
		expect(output).toContain("Settings");
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
