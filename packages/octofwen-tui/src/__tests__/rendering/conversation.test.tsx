import { describe, expect, it } from "bun:test";
import {
	MessageDisplay,
	stripCompactionSummaryTags,
} from "../../rendering/messages.tsx";
import {
	StaticItemRenderer,
	toStaticItems,
} from "../../rendering/static_items.tsx";

describe("terminal conversation rendering", () => {
	it("exports static and message renderers", () => {
		expect(StaticItemRenderer).toBeFunction();
		expect(MessageDisplay).toBeFunction();
	});

	it("converts history entries into static render items", () => {
		const history = [
			{
				type: "notification" as const,
				content: "ready",
			},
		];

		expect(toStaticItems(history)).toEqual([
			{
				type: "history-item",
				item: history[0],
			},
		]);
	});

	it("strips compaction summary wrapper tags from text only", () => {
		expect(stripCompactionSummaryTags("<summary>compact</summary>")).toBe(
			"compact",
		);
		expect(stripCompactionSummaryTags("compact")).toBe("compact");
	});
});
