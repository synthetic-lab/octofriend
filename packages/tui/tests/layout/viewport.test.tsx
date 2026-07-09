import { describe, expect, it } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import React from "react";

const TERMINAL_SIZE_PATTERN = /^\d+x\d+$/;

import {
	DEFAULT_TERMINAL_SIZE,
	TerminalSizeProvider,
	TerminalSizeTracker,
	useTerminalContentWidth,
	useTerminalSize,
} from "../../src/layout/viewport";

function TerminalSizeProbe() {
	const size = useTerminalSize();
	return <Text>{`${size.width}x${size.height}`}</Text>;
}

function ContentWidthProbe({ maxWidth }: { maxWidth?: number }) {
	const width = useTerminalContentWidth(maxWidth);
	return <Text>{width}</Text>;
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

	it("clamps content width to terminal size and max width", () => {
		const narrow = render(
			<TerminalSizeProvider size={{ width: 20, height: 10 }}>
				<ContentWidthProbe />
			</TerminalSizeProvider>,
		);
		const wide = render(
			<TerminalSizeProvider size={{ width: 120, height: 10 }}>
				<ContentWidthProbe />
			</TerminalSizeProvider>,
		);
		const custom = render(
			<TerminalSizeProvider size={{ width: 120, height: 10 }}>
				<ContentWidthProbe maxWidth={64} />
			</TerminalSizeProvider>,
		);

		expect(narrow.lastFrame()).toBe("20");
		expect(wide.lastFrame()).toBe("80");
		expect(custom.lastFrame()).toBe("64");
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

	it("does not rerender children when resize keeps the same dimensions", async () => {
		let updateCommits = 0;
		const instance = render(
			<React.Profiler
				id="terminal-size"
				onRender={(_id, phase) => {
					if (phase === "update") updateCommits += 1;
				}}
			>
				<TerminalSizeTracker>
					<TerminalSizeProbe />
				</TerminalSizeTracker>
			</React.Profiler>,
		);
		await Bun.sleep(20);
		expect(updateCommits).toBe(0);
		const frameBeforeResize = instance.lastFrame();
		expect(frameBeforeResize).toMatch(TERMINAL_SIZE_PATTERN);
		updateCommits = 0;

		process.stdout.emit("resize");
		await Bun.sleep(20);

		expect(instance.lastFrame()).toBe(frameBeforeResize);
		expect(updateCommits).toBe(0);
	});
});
