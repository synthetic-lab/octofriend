import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import {
	SelectInput,
	ThemedSelectIndicator,
	ThemedSelectItem,
} from "../../menu/select.tsx";

describe("SelectInput", () => {
	it("renders visible selectable labels", () => {
		const { lastFrame } = render(
			<SelectInput
				items={[
					{ label: "First", value: "first" },
					{ label: "Second", value: "second" },
				]}
			/>,
		);

		const output = lastFrame() || "";
		expect(output).toContain("First");
		expect(output).toContain("Second");
	});

	it("respects the visible item limit", () => {
		const { lastFrame } = render(
			<SelectInput
				limit={2}
				items={[
					{ label: "One", value: "one" },
					{ label: "Two", value: "two" },
					{ label: "Three", value: "three" },
				]}
			/>,
		);

		const output = lastFrame() || "";
		expect(output).toContain("One");
		expect(output).toContain("Two");
		expect(output).not.toContain("Three");
	});
});

describe("themed select components", () => {
	it("render selected and unselected item labels", () => {
		const selected = render(
			<ThemedSelectItem isSelected={true} label="Chosen" />,
		);
		const unselected = render(<ThemedSelectItem label="Plain" />);

		expect(selected.lastFrame()).toContain("Chosen");
		expect(unselected.lastFrame()).toContain("Plain");
	});

	it("renders a marker only for selected indicator state", () => {
		const selected = render(<ThemedSelectIndicator isSelected={true} />);
		const unselected = render(<ThemedSelectIndicator isSelected={false} />);

		expect(selected.lastFrame()?.trim().length).toBeGreaterThan(0);
		expect(unselected.lastFrame()?.trim()).toBe("");
	});
});
