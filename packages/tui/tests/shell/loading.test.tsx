import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import stringWidth from "string-width";
import {
	DEFAULT_LOADING_STRINGS,
	LONGEST_LOADING_STRING,
	Loading,
	loadingStatusPaddingLength,
	loadingStringsOrDefault,
	longestLoadingStatusWidth,
	Spinner,
} from "../../src/shell/loading.tsx";

const TESTING_COPY_PADDING_PATTERN = /Testing {2,}$/;
const COPY_PADDING_PATTERN = / {2,}$/;

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await Bun.sleep(25);
	}
	throw new Error("Timed out waiting for condition");
}

describe("Loading", () => {
	it("renders the first default loading label", () => {
		const { lastFrame } = render(<Loading />);

		expect(lastFrame()).toContain(DEFAULT_LOADING_STRINGS[0]);
	});

	it("renders the first override loading label", () => {
		const { lastFrame } = render(
			<Loading overrideStrings={["Testing status"]} />,
		);

		expect(lastFrame()).toContain("Testing status");
	});

	it("normalizes CR line breaks in override loading labels", () => {
		expect(loadingStringsOrDefault(["Testing\r\nstatus\rnow"])).toEqual([
			"Testing\nstatus\nnow",
		]);
		const { lastFrame } = render(
			<Loading overrideStrings={["Testing\r\nstatus\rnow"]} />,
		);

		const frame = lastFrame() ?? "";
		expect(frame).toContain("Testing");
		expect(frame).toContain("status");
		expect(frame).toContain("now");
		expect(frame).not.toContain("\r");
	});

	it("reserves status width without copyable padding spaces", () => {
		const { lastFrame } = render(<Loading overrideStrings={["Testing"]} />);

		expect(lastFrame() ?? "").toContain("Testing");
		expect(lastFrame() ?? "").not.toMatch(TESTING_COPY_PADDING_PATTERN);
	});

	it("falls back to default labels for empty override lists", () => {
		const { lastFrame } = render(<Loading overrideStrings={[]} />);

		expect(lastFrame()).toContain(DEFAULT_LOADING_STRINGS[0]);
	});

	it("ignores blank override labels without rendering copyable padding", () => {
		expect(loadingStringsOrDefault(["  ", " Custom "])).toEqual(["Custom"]);

		const { lastFrame } = render(<Loading overrideStrings={["  "]} />);

		expect(lastFrame()).toContain(DEFAULT_LOADING_STRINGS[0]);
		expect(lastFrame() ?? "").not.toMatch(COPY_PADDING_PATTERN);
	});

	it("clamps the active label when override labels shrink", async () => {
		const instance = render(<Loading overrideStrings={["One", "Two"]} />);
		await waitFor(() => (instance.lastFrame() ?? "").includes("Two"));

		instance.rerender(<Loading overrideStrings={["Only"]} />);

		expect(instance.lastFrame()).toContain("Only");
	});

	it("exports the longest default loading string", () => {
		expect(LONGEST_LOADING_STRING).toBe("Manipulating");
	});

	it("keeps loading status width stable across labels and dots", () => {
		const statusWidth = longestLoadingStatusWidth(DEFAULT_LOADING_STRINGS);
		const labelsAndDots = [
			["Scheming", ""],
			["Scheming", "..."],
			["Manipulating", ""],
			["Manipulating", "..."],
		] as const;

		for (const [label, dots] of labelsAndDots) {
			const paddingLength = loadingStatusPaddingLength(
				label,
				dots,
				statusWidth,
			);

			expect(label.length + dots.length + paddingLength).toBe(statusWidth);
		}
	});

	it("keeps loading status width stable for wide Unicode labels", () => {
		const labels = ["Test", "界界界"] as const;
		const statusWidth = longestLoadingStatusWidth(labels);
		const paddingLength = loadingStatusPaddingLength(
			"Test",
			"...",
			statusWidth,
		);

		expect(statusWidth).toBe(stringWidth("界界界..."));
		expect(paddingLength).toBe(2);
		expect(loadingStatusPaddingLength("界界界", "...", statusWidth)).toBe(0);
	});
});

describe("Spinner", () => {
	it("renders a frame from the selected spinner", () => {
		const { lastFrame } = render(<Spinner type="binary" />);

		expect(lastFrame()?.length).toBeGreaterThan(0);
	});
});
