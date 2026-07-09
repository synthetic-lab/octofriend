import { describe, expect, it } from "bun:test";
import {
	formatTimeUntil,
	parseQuotaJson,
	type QuotaData,
} from "../../../src/shell/state/quota";

describe("parseQuotaJson", () => {
	it("parses rolling five-hour and weekly quota entries", () => {
		const parsed = parseQuotaJson(
			JSON.stringify({
				rollingFiveHourLimit: {
					remaining: 2.5,
					max: 10,
					nextTickAt: "2026-03-02T13:00:00Z",
					tickPercent: 0.25,
				},
				weeklyTokenLimit: {
					nextRegenAt: "2026-03-03T12:00:00Z",
					percentRemaining: 50,
					maxCredits: "1000",
					remainingCredits: "500",
					nextRegenCredits: "100",
				},
			}),
		);

		expect(parsed).toEqual({
			rollingFiveHourLimit: {
				remaining: 2.5,
				max: 10,
				nextTickAt: new Date("2026-03-02T13:00:00Z"),
				tickPercent: 0.25,
			},
			weeklyTokenLimit: {
				nextRegenAt: new Date("2026-03-03T12:00:00Z"),
				percentRemaining: 50,
				maxCredits: "1000",
				remainingCredits: "500",
				nextRegenCredits: "100",
			},
		} satisfies QuotaData);
	});

	it("returns only valid quota branches", () => {
		const parsed = parseQuotaJson(
			JSON.stringify({
				rollingFiveHourLimit: {
					remaining: 1,
					max: 2,
					nextTickAt: "2026-03-02T12:30:00Z",
					tickPercent: 0.5,
				},
				weeklyTokenLimit: {
					nextRegenAt: "not-a-date",
					percentRemaining: 50,
					maxCredits: "1000",
					remainingCredits: "500",
					nextRegenCredits: "100",
				},
			}),
		);

		expect(parsed).toEqual({
			rollingFiveHourLimit: {
				remaining: 1,
				max: 2,
				nextTickAt: new Date("2026-03-02T12:30:00Z"),
				tickPercent: 0.5,
			},
		});
	});

	it("returns undefined for malformed JSON, non-object JSON, missing quotas, invalid dates, and invalid field types", () => {
		expect(parseQuotaJson("not json")).toBeUndefined();
		expect(parseQuotaJson("null")).toBeUndefined();
		expect(parseQuotaJson("[]")).toBeUndefined();
		expect(parseQuotaJson("{}")).toBeUndefined();
		expect(
			parseQuotaJson(
				JSON.stringify({
					rollingFiveHourLimit: {
						remaining: "1",
						max: 2,
						nextTickAt: "2026-03-02T12:30:00Z",
						tickPercent: 0.5,
					},
				}),
			),
		).toBeUndefined();
		expect(
			parseQuotaJson(
				JSON.stringify({
					rollingFiveHourLimit: {
						remaining: 1,
						max: 2,
						nextTickAt: "invalid",
						tickPercent: 0.5,
					},
				}),
			),
		).toBeUndefined();
	});
});

describe("formatTimeUntil", () => {
	const now = new Date("2026-03-02T12:00:00Z");

	it("formats minutes, hours, and days with pluralization", () => {
		expect(formatTimeUntil(new Date("2026-03-02T12:01:00Z"), now)).toBe(
			"in 1 minute",
		);
		expect(formatTimeUntil(new Date("2026-03-02T12:30:00Z"), now)).toBe(
			"in 30 minutes",
		);
		expect(formatTimeUntil(new Date("2026-03-02T13:00:00Z"), now)).toBe(
			"in 1 hour",
		);
		expect(formatTimeUntil(new Date("2026-03-02T15:00:00Z"), now)).toBe(
			"in 3 hours",
		);
		expect(formatTimeUntil(new Date("2026-03-03T12:00:00Z"), now)).toBe(
			"in 1 day",
		);
		expect(formatTimeUntil(new Date("2026-03-05T12:00:00Z"), now)).toBe(
			"in 3 days",
		);
	});

	it("formats mixed hour/minute and day/hour durations", () => {
		expect(formatTimeUntil(new Date("2026-03-02T13:45:00Z"), now)).toBe(
			"in 1 hour 45 minutes",
		);
		expect(formatTimeUntil(new Date("2026-03-02T13:01:00Z"), now)).toBe(
			"in 1 hour 1 minute",
		);
		expect(formatTimeUntil(new Date("2026-03-03T18:00:00Z"), now)).toBe(
			"in 1 day 6 hours",
		);
		expect(formatTimeUntil(new Date("2026-03-03T13:00:00Z"), now)).toBe(
			"in 1 day 1 hour",
		);
	});

	it("handles unit boundaries and rounds positive sub-minute durations up", () => {
		expect(formatTimeUntil(new Date("2026-03-02T12:59:00Z"), now)).toBe(
			"in 59 minutes",
		);
		expect(formatTimeUntil(new Date("2026-03-02T13:00:00Z"), now)).toBe(
			"in 1 hour",
		);
		expect(formatTimeUntil(new Date("2026-03-03T11:00:00Z"), now)).toBe(
			"in 23 hours",
		);
		expect(formatTimeUntil(new Date("2026-03-03T12:00:00Z"), now)).toBe(
			"in 1 day",
		);
		expect(formatTimeUntil(new Date("2026-03-02T12:00:30Z"), now)).toBe(
			"in 1 minute",
		);
		expect(formatTimeUntil(new Date("2026-03-02T12:00:01Z"), now)).toBe(
			"in 1 minute",
		);
	});

	it("formats zero or past timestamps as 0 minutes", () => {
		expect(formatTimeUntil(new Date("2026-03-02T12:00:00Z"), now)).toBe(
			"in 0 minutes",
		);
		expect(formatTimeUntil(new Date("2026-03-02T11:59:30Z"), now)).toBe(
			"in 0 minutes",
		);
		expect(formatTimeUntil(new Date("2026-03-02T11:55:00Z"), now)).toBe(
			"in 0 minutes",
		);
		expect(formatTimeUntil(new Date("2026-03-02T10:00:00Z"), now)).toBe(
			"in 0 minutes",
		);
		expect(formatTimeUntil(new Date("2026-02-28T12:00:00Z"), now)).toBe(
			"in 0 minutes",
		);
	});
});
