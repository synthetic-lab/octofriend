import { afterEach, describe, expect, it } from "bun:test";
import { displayLog, error, log, setLevel } from "../../app/runtime_logging.ts";

const originalLog = console.log;
const originalError = console.error;

afterEach(() => {
	console.log = originalLog;
	console.error = originalError;
	setLevel("info");
});

describe("runtime logging", () => {
	it("logs info messages at info level and suppresses verbose messages", () => {
		const entries: unknown[][] = [];
		console.log = (...args: unknown[]) => entries.push(args);

		setLevel("info");
		log("verbose", "hidden");
		log("info", "visible", 1);

		expect(entries).toEqual([["visible", 1]]);
	});

	it("logs verbose messages when verbose logging is enabled", () => {
		const entries: unknown[][] = [];
		console.error = (...args: unknown[]) => entries.push(args);

		setLevel("verbose");
		error("verbose", "visible");

		expect(entries).toEqual([["visible"]]);
	});

	it("selects display text based on the current log level", () => {
		setLevel("info");
		expect(displayLog({ info: "short", verbose: "long" })).toBe("short");

		setLevel("verbose");
		expect(displayLog({ info: "short", verbose: "long" })).toBe("long");
	});
});
