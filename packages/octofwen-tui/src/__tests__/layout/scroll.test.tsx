import { describe, expect, it } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { useContext } from "react";
import { IsScrollableContext, ScrollView } from "../../layout/scroll.tsx";

function ScrollableProbe() {
	const isScrollable = useContext(IsScrollableContext);
	return <Text>{isScrollable ? "scrollable" : "not-scrollable"}</Text>;
}

describe("ScrollView", () => {
	it("renders children", () => {
		const { lastFrame } = render(
			<ScrollView height={10}>
				<Text>Visible content</Text>
			</ScrollView>,
		);

		expect(lastFrame()).toContain("Visible content");
	});

	it("provides scrollability state through context", () => {
		const { lastFrame } = render(
			<ScrollView height={10}>
				<ScrollableProbe />
			</ScrollView>,
		);

		expect(lastFrame()).toContain("not-scrollable");
	});
});
