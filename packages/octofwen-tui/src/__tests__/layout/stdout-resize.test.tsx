import { describe, expect, it } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { useStdoutResize } from "../../layout/stdout-resize.ts";

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
}

function ResizeProbe({ onResize }: { onResize: () => void }) {
	useStdoutResize(onResize);
	return <Text>resize-probe</Text>;
}

describe("useStdoutResize", () => {
	it("shares one process stdout resize listener across subscribers", async () => {
		const listenerCountBefore = process.stdout.listenerCount("resize");
		let firstResizeCount = 0;
		let secondResizeCount = 0;
		const instance = render(
			<>
				<ResizeProbe onResize={() => firstResizeCount++} />
				<ResizeProbe onResize={() => secondResizeCount++} />
			</>,
		);

		await waitFor(() => process.stdout.listenerCount("resize") > 0);
		expect(process.stdout.listenerCount("resize")).toBeLessThanOrEqual(
			listenerCountBefore + 1,
		);

		process.stdout.emit("resize");
		process.stdout.emit("resize");
		await waitFor(() => firstResizeCount === 1 && secondResizeCount === 1);
		expect(firstResizeCount).toBe(1);
		expect(secondResizeCount).toBe(1);

		instance.unmount();
		await waitFor(
			() => process.stdout.listenerCount("resize") <= listenerCountBefore,
		);
		expect(process.stdout.listenerCount("resize")).toBeLessThanOrEqual(
			listenerCountBefore,
		);
	});
});
