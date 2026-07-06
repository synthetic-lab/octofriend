import { describe, expect, it } from "bun:test";
import {
	closeTag,
	openTag,
	StreamingXMLParser,
	tagged,
	type XMLEvent,
	xmlEscape,
} from "../../app/xml_markup.ts";

describe("xml markup helpers", () => {
	it("builds opening, closing, and wrapped tags", () => {
		expect(openTag("tool", { name: "read", id: "call-1" })).toBe(
			'<tool name="read" id="call-1">',
		);
		expect(closeTag("tool")).toBe("</tool>");
		expect(tagged("tool", { name: "read" }, "content")).toBe(
			'<tool name="read">content</tool>',
		);
	});

	it("escapes XML-sensitive characters", () => {
		expect(xmlEscape(`A&B <tag attr="'">`)).toBe(
			"A&amp;B &lt;tag attr=&quot;&apos;&quot;&gt;",
		);
	});
});

describe("StreamingXMLParser", () => {
	it("emits text and tag events across partial chunks", () => {
		const events: XMLEvent[] = [];
		const parser = new StreamingXMLParser({
			handlers: {
				onOpenTag: (event) => events.push(event),
				onCloseTag: (event) => events.push(event),
				onText: (event) => events.push(event),
			},
		});

		parser.write("hello <too");
		parser.write("l>world</tool>");
		parser.close();

		expect(events).toEqual([
			{ type: "text", content: "h" },
			{ type: "text", content: "e" },
			{ type: "text", content: "l" },
			{ type: "text", content: "l" },
			{ type: "text", content: "o" },
			{ type: "text", content: " " },
			{ type: "openTag", name: "tool", attributes: {} },
			{ type: "text", content: "w" },
			{ type: "text", content: "o" },
			{ type: "text", content: "r" },
			{ type: "text", content: "l" },
			{ type: "text", content: "d" },
			{ type: "closeTag", name: "tool" },
		]);
	});

	it("treats non-whitelisted tags as text", () => {
		const events: XMLEvent[] = [];
		const parser = new StreamingXMLParser({
			whitelist: ["allowed"],
			handlers: {
				onOpenTag: (event) => events.push(event),
				onCloseTag: (event) => events.push(event),
				onText: (event) => events.push(event),
			},
		});

		parser.write("<blocked><allowed/>");
		parser.close();

		expect(events).toEqual([
			{ type: "text", content: "<b" },
			{ type: "text", content: "l" },
			{ type: "text", content: "o" },
			{ type: "text", content: "c" },
			{ type: "text", content: "k" },
			{ type: "text", content: "e" },
			{ type: "text", content: "d" },
			{ type: "text", content: ">" },
			{ type: "openTag", name: "allowed", attributes: {} },
			{ type: "closeTag", name: "allowed" },
		]);
	});

	it("ignores writes after close", () => {
		const events: XMLEvent[] = [];
		const parser = new StreamingXMLParser({
			handlers: { onText: (event) => events.push(event) },
		});
		parser.close();
		parser.write("text");
		expect(events).toEqual([]);
	});
});
