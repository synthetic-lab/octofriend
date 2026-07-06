import { describe, expect, test } from "bun:test";
import { runNotifyCommand } from "../../../internal/configuration/notify.ts";
import type { Config } from "../../../internal/configuration/schemas.ts";

describe("notification configuration", () => {
	const baseConfig: Config = {
		yourName: "Test User",
		models: [],
	};

	test("uses toasted desktop notifications when no shell notify command is configured", async () => {
		const notifications: unknown[] = [];

		const result = await runNotifyCommand(
			{
				...baseConfig,
				notifications: {
					notifyTimeoutMs: 250,
					alwaysNotify: true,
				},
			},
			async (notification) => {
				notifications.push(notification);
			},
		);

		expect(result.success).toBe(true);
		expect(notifications).toEqual([
			{ title: "Octofwen", message: "Octo is waiting for input." },
		]);
	});

	test("treats an empty shell notify command as the built-in desktop notifier", async () => {
		const notifications: unknown[] = [];

		const result = await runNotifyCommand(
			{
				...baseConfig,
				notifications: {
					notifyCommand: "  ",
					notifyTimeoutMs: 250,
					alwaysNotify: true,
				},
			},
			async (notification) => {
				notifications.push(notification);
			},
		);

		expect(result.success).toBe(true);
		expect(notifications).toEqual([
			{ title: "Octofwen", message: "Octo is waiting for input." },
		]);
	});

	test("returns Result errors from desktop notification failures", async () => {
		const result = await runNotifyCommand(baseConfig, async () =>
			Promise.reject(new Error("notify failed")),
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe("notify failed");
		}
	});
});
