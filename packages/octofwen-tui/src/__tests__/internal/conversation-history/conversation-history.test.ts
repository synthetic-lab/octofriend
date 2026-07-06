import { describe, expect, it } from "bun:test";
import {
	type HistoryItem,
	outputToHistory,
	toLlmIR,
} from "../../../internal/conversation-history/main.ts";

type TestIr =
	| { role: "user"; content: string }
	| { role: "assistant"; content: string };

describe("conversation history", () => {
	it("wraps trajectory output IR items as history entries", () => {
		const output: TestIr[] = [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi" },
		];

		expect(outputToHistory(output)).toEqual([
			{ type: "llm-ir", ir: { role: "user", content: "hello" } },
			{ type: "llm-ir", ir: { role: "assistant", content: "hi" } },
		]);
	});

	it("extracts only LLM IR entries from mixed history", () => {
		const history: HistoryItem<TestIr>[] = [
			{ type: "notification", content: "heads up" },
			{ type: "request-failed" },
			{ type: "llm-ir", ir: { role: "user", content: "hello" } },
			{ type: "compaction-failed" },
			{ type: "llm-ir", ir: { role: "assistant", content: "hi" } },
		];

		expect(toLlmIR(history)).toEqual([
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi" },
		]);
	});
});
