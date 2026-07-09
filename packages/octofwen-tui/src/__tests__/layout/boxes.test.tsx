import { describe, expect, it } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { CenteredBox, HeightlessCenteredBox } from "../../layout/boxes.tsx";
import { TerminalSizeProvider } from "../../layout/viewport.tsx";

describe("CenteredBox", () => {
	it("renders its children inside the centered layout", () => {
		const { lastFrame } = render(
			<CenteredBox>
				<Text>Centered content</Text>
			</CenteredBox>,
		);

		expect(lastFrame()).toContain("Centered content");
	});

	it("fits content width to narrow terminals", () => {
		const { lastFrame } = render(
			<TerminalSizeProvider size={{ width: 20, height: 10 }}>
				<CenteredBox>
					<Text wrap="wrap">123456789012345678901234567890</Text>
				</CenteredBox>
			</TerminalSizeProvider>,
		);

		expect(lastFrame()).toContain("12345678901234567890\n");
		expect(lastFrame()).toContain("1234567890");
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

	it("fits content width to narrow terminals", () => {
		const { lastFrame } = render(
			<TerminalSizeProvider size={{ width: 20, height: 10 }}>
				<HeightlessCenteredBox>
					<Text wrap="wrap">123456789012345678901234567890</Text>
				</HeightlessCenteredBox>
			</TerminalSizeProvider>,
		);

		expect(lastFrame()).toContain("12345678901234567890\n");
		expect(lastFrame()).toContain("1234567890");
	});
});
