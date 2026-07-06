import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import {
	DEFAULT_LOADING_STRINGS,
	LONGEST_LOADING_STRING,
	Loading,
	Spinner,
} from "../../app/loading.tsx";

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

	it("exports the longest default loading string", () => {
		expect(LONGEST_LOADING_STRING).toBe("Manipulating");
	});
});

describe("Spinner", () => {
	it("renders a frame from the selected spinner", () => {
		const { lastFrame } = render(<Spinner type="binary" />);

		expect(lastFrame()?.length).toBeGreaterThan(0);
	});
});
