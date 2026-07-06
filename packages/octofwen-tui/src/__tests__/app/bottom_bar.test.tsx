import { describe, expect, it } from "bun:test";
import {
	BottomBar,
	BottomBarContent,
	bottomBarVersionMessage,
} from "../../app/bottom_bar.tsx";

describe("terminal bottom bar", () => {
	it("exports the bottom bar components", () => {
		expect(BottomBar).toBeFunction();
		expect(BottomBarContent).toBeFunction();
	});

	it("formats version-check status messages", () => {
		expect(bottomBarVersionMessage("0.0.1", "0.0.2")).toBe(
			"New version released! Run `bun install --global octofwen` to update.",
		);
		expect(bottomBarVersionMessage("0.0.2", "0.0.2")).toBe(
			"Octo is up-to-date.",
		);
		expect(bottomBarVersionMessage("0.0.2", null)).toBe("Octo is up-to-date.");
	});
});
