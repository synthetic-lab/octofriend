import { describe, expect, it } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { CenteredBox, HeightlessCenteredBox } from "../../layout/boxes.tsx";

describe("CenteredBox", () => {
	it("renders its children inside the centered layout", () => {
		const { lastFrame } = render(
			<CenteredBox>
				<Text>Centered content</Text>
			</CenteredBox>,
		);

		expect(lastFrame()).toContain("Centered content");
	});
});

describe("HeightlessCenteredBox", () => {
	it("renders its children inside the heightless centered layout", () => {
		const { lastFrame } = render(
			<HeightlessCenteredBox>
				<Text>Heightless content</Text>
			</HeightlessCenteredBox>,
		);

		expect(lastFrame()).toContain("Heightless content");
	});
});
