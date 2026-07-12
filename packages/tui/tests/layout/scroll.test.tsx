import { describe, expect, it } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { useContext } from "react";
import {
	IsScrollableContext,
	parseMouseScrollDirection,
	ScrollView,
} from "../../src/layout/scroll.tsx";

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Timed out waiting for condition");
}

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

	it("keeps mouse tracking writes on Ink stdout", async () => {
		const writes: string[] = [];
		const originalWrite = process.stdout.write;
		process.stdout.write = ((chunk: string | Uint8Array) => {
			writes.push(String(chunk));
			return true;
		}) as typeof process.stdout.write;

		try {
			const instance = render(
				<ScrollView height={1}>
					<Text>one</Text>
					<Text>two</Text>
					<Text>three</Text>
				</ScrollView>,
			);

			await waitFor(() => (instance.lastFrame() ?? "").includes("100% ↑"));
			expect(writes).toEqual([]);
			instance.unmount();
			await Bun.sleep(1);
			expect(writes).toEqual([]);
		} finally {
			process.stdout.write = originalWrite;
		}
	});

	it("parses mouse wheel escape sequences from buffers without string decoding", () => {
		expect(parseMouseScrollDirection(Buffer.from("\u001b[96;10;20M"))).toBe(
			"SCROLL_UP",
		);
		expect(parseMouseScrollDirection(Buffer.from("\u001b[97;10;20M"))).toBe(
			"SCROLL_DOWN",
		);
		expect(parseMouseScrollDirection(Buffer.from("\u001b[<64;10;20M"))).toBe(
			"SCROLL_UP",
		);
		expect(parseMouseScrollDirection(Buffer.from("\u001b[<65;10;20M"))).toBe(
			"SCROLL_DOWN",
		);
		expect(
			parseMouseScrollDirection(Buffer.from([27, 91, 77, 96, 10, 20])),
		).toBe("SCROLL_UP");
		expect(
			parseMouseScrollDirection(Buffer.from("plain text")),
		).toBeUndefined();
	});
});
