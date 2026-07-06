import { describe, expect, it } from "bun:test";
import {
	sleep,
	ThrottledBuffer,
	throttledBuffer,
	timeout,
} from "../../../app/state/scheduling.ts";

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
