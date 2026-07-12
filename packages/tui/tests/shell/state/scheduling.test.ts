import { describe, expect, it } from "bun:test";
import {
	sleep,
	ThrottledBuffer,
	ThrottledMergeBuffer,
	throttledBuffer,
	throttledMergeBuffer,
	timeout,
} from "../../../src/shell/state/scheduling.ts";

describe("sleep", () => {
	it("resolves after the requested delay", async () => {
		const startedAt = Date.now();

		await sleep(5);

		expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1);
	});
});

describe("timeout", () => {
	it("returns an AbortSignal that aborts after the requested delay", async () => {
		const signal = timeout(5);

		expect(signal.aborted).toBe(false);
		await sleep(10);
		expect(signal.aborted).toBe(true);
	});
});

describe("throttled buffer", () => {
	it("buffers emitted values until the throttle delay", async () => {
		const values: number[] = [];
		const buffer = throttledBuffer<number>(10, (value) => values.push(value));

		buffer.emit(1);
		buffer.emit(2);

		expect(values).toEqual([]);
		await sleep(20);
		expect(values).toEqual([1, 2]);
	});

	it("flushes immediately and cancels the scheduled flush", async () => {
		const values: number[] = [];
		const buffer = new ThrottledBuffer<number>(20, (value) =>
			values.push(value),
		);

		buffer.emit(1);
		buffer.flush();

		expect(values).toEqual([1]);
		await sleep(30);
		expect(values).toEqual([1]);
	});
});

describe("throttled merge buffer", () => {
	it("coalesces emitted partials into one callback", async () => {
		const values: Array<{ count?: number; label?: string }> = [];
		const buffer = throttledMergeBuffer<{ count?: number; label?: string }>(
			10,
			(value) => values.push(value),
		);

		buffer.emit({ count: 1 });
		buffer.emit({ label: "ready" });
		buffer.emit({ count: 2 });

		expect(values).toEqual([]);
		await sleep(20);
		expect(values).toEqual([{ count: 2, label: "ready" }]);
	});

	it("flushes immediately and cancels the scheduled merge", async () => {
		const values: Array<{ count: number }> = [];
		const buffer = new ThrottledMergeBuffer<{ count: number }>(20, (value) =>
			values.push(value),
		);

		buffer.emit({ count: 1 });
		buffer.emit({ count: 2 });
		buffer.flush();

		expect(values).toEqual([{ count: 2 }]);
		await sleep(30);
		expect(values).toEqual([{ count: 2 }]);
	});
});
