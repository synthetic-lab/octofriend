import { describe, expect, test } from "bun:test";
import {
	type InputHistoryAppendParams,
	type InputHistoryLoadParams,
	loadInputHistory,
	MAX_HISTORY_ITEMS,
} from "../input-history.ts";

function bridgeBackedInputHistoryStore(initialHistory: string[] = []) {
	let history = [...initialHistory];
	const loads: InputHistoryLoadParams[] = [];
	const appends: InputHistoryAppendParams[] = [];
	return {
		loads,
		appends,
		load: (params: InputHistoryLoadParams) => {
			loads.push(params);
			return Promise.resolve({ history: [...history] });
		},
		append: (params: InputHistoryAppendParams) => {
			appends.push(params);
			if (params.input.trim()) history = [...history, params.input];
			return Promise.resolve({ history: [...history] });
		},
	};
}

describe("loadInputHistory", () => {
	test("loads empty history and appends non-empty items through the bridge", async () => {
		const store = bridgeBackedInputHistoryStore();
		const result = await loadInputHistory({
			load: store.load,
			append: store.append,
			databasePath: "/tmp/history.sqlite",
		});
		expect(result.success).toBe(true);
		if (!result.success) return;
		const inputHistory = result.data;

		expect(inputHistory.getCurrentHistory()).toEqual([]);

		await inputHistory.appendToInputHistory("first prompt");

		expect(inputHistory.getCurrentHistory()).toEqual(["first prompt"]);
		expect(store.appends).toEqual([
			{
				input: "first prompt",
				databasePath: "/tmp/history.sqlite",
				maxHistoryItems: MAX_HISTORY_ITEMS,
			},
		]);
	});

	test("ignores blank input before calling the bridge", async () => {
		const store = bridgeBackedInputHistoryStore(["existing"]);
		const result = await loadInputHistory({
			load: store.load,
			append: store.append,
		});
		expect(result.success).toBe(true);
		if (!result.success) return;
		const inputHistory = result.data;

		await inputHistory.appendToInputHistory("   ");

		expect(inputHistory.getCurrentHistory()).toEqual(["existing"]);
		expect(store.appends).toEqual([]);
	});

	test("passes configured database path and limit to bridge load and append calls", async () => {
		const store = bridgeBackedInputHistoryStore();
		const result = await loadInputHistory({
			load: store.load,
			append: store.append,
			databasePath: "/tmp/custom.sqlite",
			maxHistoryItems: 3,
		});
		expect(result.success).toBe(true);
		if (!result.success) return;
		const inputHistory = result.data;

		await inputHistory.appendToInputHistory("prompt");

		expect(store.loads).toEqual([
			{ databasePath: "/tmp/custom.sqlite", maxHistoryItems: 3 },
		]);
		expect(store.appends).toEqual([
			{
				input: "prompt",
				databasePath: "/tmp/custom.sqlite",
				maxHistoryItems: 3,
			},
		]);
	});

	test("omits database path by default so storage owns the persisted location", async () => {
		const store = bridgeBackedInputHistoryStore();
		const result = await loadInputHistory({
			load: store.load,
			append: store.append,
		});
		expect(result.success).toBe(true);
		if (!result.success) return;
		const inputHistory = result.data;

		await inputHistory.appendToInputHistory("prompt");

		expect(store.loads).toEqual([{ maxHistoryItems: MAX_HISTORY_ITEMS }]);
		expect(store.appends).toEqual([
			{ input: "prompt", maxHistoryItems: MAX_HISTORY_ITEMS },
		]);
	});
	test("returns an error when bridge functions are missing", async () => {
		const result = await loadInputHistory();

		expect(result).toEqual({
			success: false,
			error: "Input history bridge is required",
		});
	});
});
