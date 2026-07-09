import { describe, expect, it } from "bun:test";
import {
	closeTag,
	openTag,
	StreamingXMLParser,
	tagged,
	type XMLEvent,
	xmlEscape,
} from "../../src/shell/xml-markup";

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

	it("ignores inherited attributes when building tags", () => {
		const attrs = Object.create({ leaked: "yes" }) as Record<string, string>;
		attrs.name = "read";

		expect(openTag("tool", attrs)).toBe('<tool name="read">');
	});

	it("escapes XML-sensitive characters", () => {
		expect(xmlEscape(`A&B <tag attr="'">`)).toBe(
			"A&amp;B &lt;tag attr=&quot;&apos;&quot;&gt;",
		);
	});
});

describe("StreamingXMLParser", () => {
	it("emits contiguous text and tag events across partial chunks", () => {
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
			{ type: "text", content: "hello " },
			{ type: "openTag", name: "tool", attributes: {} },
			{ type: "text", content: "world" },
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
			{ type: "text", content: "locked>" },
			{ type: "openTag", name: "allowed", attributes: {} },
			{ type: "closeTag", name: "allowed" },
		]);
	});

	it("allows whitespace before opening and self-closing tag ends", () => {
		const events: XMLEvent[] = [];
		const parser = new StreamingXMLParser({
			handlers: {
				onOpenTag: (event) => events.push(event),
				onCloseTag: (event) => events.push(event),
				onText: (event) => events.push(event),
			},
		});

		parser.write("<tool >body<next />");
		parser.close();

		expect(events).toEqual([
			{ type: "openTag", name: "tool", attributes: {} },
			{ type: "text", content: "body" },
			{ type: "openTag", name: "next", attributes: {} },
			{ type: "closeTag", name: "next" },
		]);
	});

	it("keeps XML tag-name character support without regex parsing", () => {
		const events: XMLEvent[] = [];
		const parser = new StreamingXMLParser({
			handlers: {
				onOpenTag: (event) => events.push(event),
				onCloseTag: (event) => events.push(event),
			},
		});

		parser.write("<tool-call.v1:_x></tool-call.v1:_x>");
		parser.close();

		expect(events).toEqual([
			{ type: "openTag", name: "tool-call.v1:_x", attributes: {} },
			{ type: "closeTag", name: "tool-call.v1:_x" },
		]);
	});

	it("keeps surrogate pairs intact inside text runs", () => {
		const events: XMLEvent[] = [];
		const parser = new StreamingXMLParser({
			handlers: { onText: (event) => events.push(event) },
		});

		parser.write("a😀b");
		parser.close();

		expect(events).toEqual([{ type: "text", content: "a😀b" }]);
	});

	it("keeps surrogate pairs intact across stream chunk boundaries", () => {
		const events: Extract<XMLEvent, { type: "text" }>[] = [];
		const parser = new StreamingXMLParser({
			handlers: { onText: (event) => events.push(event) },
		});

		parser.write("a\ud83d");
		parser.write("\ude00b");
		parser.close();

		expect(events.map((event) => event.content).join("")).toBe("a😀b");
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
