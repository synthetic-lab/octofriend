import { describe, expect, it } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";

const TERMINAL_SIZE_PATTERN = /^\d+x\d+$/;

import {
	DEFAULT_TERMINAL_SIZE,
	TerminalSizeProvider,
	TerminalSizeTracker,
	useTerminalSize,
} from "../../layout/viewport.tsx";

function TerminalSizeProbe() {
	const size = useTerminalSize();
	return <Text>{`${size.width}x${size.height}`}</Text>;
}

describe("useTerminalSize", () => {
	it("returns the default terminal size outside a provider", () => {
		const { lastFrame } = render(<TerminalSizeProbe />);

		expect(lastFrame()).toBe(
			`${DEFAULT_TERMINAL_SIZE.width}x${DEFAULT_TERMINAL_SIZE.height}`,
		);
	});

	it("returns the provided terminal size", () => {
		const { lastFrame } = render(
			<TerminalSizeProvider size={{ width: 120, height: 40 }}>
				<TerminalSizeProbe />
			</TerminalSizeProvider>,
		);

		expect(lastFrame()).toBe("120x40");
	});
});

describe("TerminalSizeTracker", () => {
	it("provides a measured terminal size to children", () => {
		const { lastFrame } = render(
			<TerminalSizeTracker>
				<TerminalSizeProbe />
			</TerminalSizeTracker>,
		);

		expect(lastFrame()).toMatch(TERMINAL_SIZE_PATTERN);
	});
});
