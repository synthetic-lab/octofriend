import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import { Profiler } from "react";
import { useAppStore } from "../../app/state/store.ts";
import { ConfigContext } from "../../internal/configuration/react-context.ts";
import {
	assistantScrollViewHeight,
	thoughtBoxWidth,
} from "../../rendering/assistant-message.tsx";
import {
	hasVisibleText,
	MessageDisplay,
	renderLlmIR,
	stripCompactionSummaryTags,
} from "../../rendering/messages.tsx";
import {
	StaticItemRenderer,
	staticItemKey,
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

	it("normalizes notification line breaks before rendering", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { lastFrame } = render(
			React.createElement(MessageDisplay, {
				item: {
					type: "notification",
					content: "first\r\nsecond\rthird",
				},
			}),
		);

		const output = lastFrame() ?? "";
		expect(output).toContain("first");
		expect(output).toContain("second");
		expect(output).toContain("third");
		expect(output).not.toContain("\r");
	});

	it("normalizes boot notification line breaks before rendering", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { lastFrame } = render(
			React.createElement(StaticItemRenderer, {
				item: {
					type: "boot-notification",
					content: "ready\r\nsteady\rgo",
				},
			}),
		);

		const output = lastFrame() ?? "";
		expect(output).toContain("ready");
		expect(output).toContain("steady");
		expect(output).toContain("go");
		expect(output).not.toContain("\r");
	});

	it("keys history static items by message identity instead of shifted list index", () => {
		const historyItem = {
			type: "history-item" as const,
			item: {
				type: "llm-ir" as const,
				ir: {
					role: "assistant" as const,
					messageId: "assistant-1",
					content: "stable",
					reasoningContent: null,
					usage: {
						input: { cached: 0, uncached: 0, total: 0 },
						output: 0,
					},
				},
			},
		};

		expect(staticItemKey(historyItem, 2)).toBe("message:assistant-1");
		expect(staticItemKey(historyItem, 9)).toBe("message:assistant-1");
	});

	it("strips compaction summary wrapper tags from text only", () => {
		expect(stripCompactionSummaryTags("<summary>compact</summary>")).toBe(
			"compact",
		);
		expect(stripCompactionSummaryTags("compact")).toBe("compact");
	});

	it("checks visible assistant text without trimming away copied whitespace", () => {
		expect(hasVisibleText("")).toBe(false);
		expect(hasVisibleText(" \n\t")).toBe(false);
		expect(hasVisibleText("\u00a0\u200b\u200e\u200f\u2060\ufe0f\ufeff")).toBe(
			false,
		);
		expect(hasVisibleText(" copied ")).toBe(true);
	});

	it("omits skipped tool output items", () => {
		expect(
			renderLlmIR(
				{
					role: "tool-skip-output",
					toolCall: {
						type: "tool-call",
						name: "read",
						toolCallId: "skipped-tool",
						parsed: {},
						original: {},
					},
					reason: "user rejected tool",
				},
				false,
			),
		).toBeNull();
	});

	it("renders compaction summary text without wrapper tags", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { lastFrame } = render(
			React.createElement(
				React.Fragment,
				null,
				renderLlmIR(
					{
						role: "checkpoint",
						content: [{ type: "text", content: "<summary>compact</summary>" }],
					},
					false,
				),
			),
		);

		const output = lastFrame() ?? "";
		expect(output).toContain("compact");
		expect(output).not.toContain("<summary>");
		expect(output).not.toContain("</summary>");
	});

	it("normalizes compaction text line breaks before rendering", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { lastFrame } = render(
			React.createElement(
				React.Fragment,
				null,
				renderLlmIR(
					{
						role: "assistant",
						messageId: "assistant-compacting-cr",
						content: "first\r\nsecond\rthird",
						reasoningContent: null,
						usage: {
							input: { cached: 0, uncached: 0, total: 0 },
							output: 0,
						},
					},
					true,
				),
			),
		);

		const output = lastFrame() ?? "";
		expect(output).toContain("first");
		expect(output).toContain("second");
		expect(output).toContain("third");
		expect(output).not.toContain("\r");
	});

	it("reserves thought-box space before sizing assistant scrollback", () => {
		expect(assistantScrollViewHeight(24, false)).toBe(17);
		expect(assistantScrollViewHeight(24, true)).toBe(15);
		expect(assistantScrollViewHeight(4, true)).toBe(1);
	});

	it("keeps thought-box width valid on tiny terminals", () => {
		expect(thoughtBoxWidth(4)).toBe(1);
		expect(thoughtBoxWidth(12)).toBe(2);
		expect(thoughtBoxWidth(200)).toBe(80);
	});

	it("passes assistant content to markdown rendering without trimming", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { lastFrame } = render(
			React.createElement(
				React.Fragment,
				null,
				renderLlmIR(
					{
						role: "assistant",
						messageId: "assistant-whitespace",
						content: "    copied",
						reasoningContent: " \n\t",
						usage: {
							input: { cached: 0, uncached: 0, total: 0 },
							output: 0,
						},
					},
					false,
				),
			),
		);

		const output = lastFrame() ?? "";
		expect(output).toContain("copied");
		expect(output).not.toContain("Thoughts");
	});

	it("normalizes reasoning text line breaks before rendering", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { lastFrame } = render(
			React.createElement(
				React.Fragment,
				null,
				renderLlmIR(
					{
						role: "assistant",
						messageId: "assistant-reasoning-cr",
						content: "answer",
						reasoningContent: "think\r\nthen\ragain",
						usage: {
							input: { cached: 0, uncached: 0, total: 0 },
							output: 0,
						},
					},
					false,
				),
			),
		);

		const output = lastFrame() ?? "";
		expect(output).toContain("think");
		expect(output).toContain("then");
		expect(output).toContain("again");
		expect(output).not.toContain("\r");
	});

	it("renders user text lines without losing CRLF-separated content", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { lastFrame } = render(
			React.createElement(
				React.Fragment,
				null,
				renderLlmIR(
					{
						role: "user",
						messageId: "user-multiline",
						content: [
							{
								type: "text",
								content: "first\r\n second\rthird\n",
							},
						],
					},
					false,
				),
			),
		);

		const output = lastFrame() ?? "";
		expect(output).toContain("first");
		expect(output).toContain(" second");
		expect(output).toContain("third");
	});

	it("does not rerender static items that do not read the active model", async () => {
		const previousModelOverride = useAppStore.getState().modelOverride;
		let renders = 0;
		const config = {
			yourName: "Ada",
			models: [
				{
					nickname: "one",
					baseUrl: "https://api.openai.com/v1",
					model: "model-one",
					context: 128000,
				},
				{
					nickname: "two",
					baseUrl: "https://api.openai.com/v1",
					model: "model-two",
					context: 128000,
				},
			],
		};

		useAppStore.setState({ modelOverride: "model-one" });
		const instance = render(
			<ConfigContext.Provider value={config}>
				<Profiler
					id="static-boot-notification"
					onRender={() => {
						renders += 1;
					}}
				>
					<StaticItemRenderer
						item={{ type: "boot-notification", content: "stable" }}
					/>
				</Profiler>
			</ConfigContext.Provider>,
		);

		await Bun.sleep(1);
		const before = renders;
		useAppStore.setState({ modelOverride: "model-two" });
		await Bun.sleep(5);

		expect(renders).toBe(before);
		instance.unmount();
		useAppStore.setState({ modelOverride: previousModelOverride });
	});

	it("does not rerender rendered messages when only mode payload changes", async () => {
		const previousModeData = useAppStore.getState().modeData;
		let renders = 0;
		useAppStore.setState({ modeData: { mode: "input", vimMode: "INSERT" } });
		const instance = render(
			<Profiler
				id="message-display"
				onRender={() => {
					renders += 1;
				}}
			>
				<MessageDisplay
					item={{
						type: "notification",
						content: "stable",
					}}
				/>
			</Profiler>,
		);

		await Bun.sleep(1);
		const before = renders;
		useAppStore.setState({ modeData: { mode: "input", vimMode: "NORMAL" } });
		await Bun.sleep(5);

		expect(renders).toBe(before);
		instance.unmount();
		useAppStore.setState({ modeData: previousModeData });
	});
});
