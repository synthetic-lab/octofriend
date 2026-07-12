import { describe, expect, it } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import React from "react";
import {
	buildDirectShortcutLookup,
	clampShortcutPage,
	handleDirectShortcut,
	handleDirectShortcutLookup,
	handlePageShortcutLookup,
	renderShortcutItems,
	type ShortcutArray,
	shortcutArraysEqual,
} from "../../src/input/shortcut-render.ts";
import {
	ConfirmDialog,
	KbShortcutPanel,
	KbShortcutSelect,
} from "../../src/input/shortcuts.tsx";

function deferred<T>() {
	let resolve: (value: T) => void = () => undefined;
	const promise = new Promise<T>((nextResolve) => {
		resolve = nextResolve;
	});
	return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Timed out waiting for condition");
}

describe("shortcut rendering helpers", () => {
	it("builds direct shortcut lookup once and preserves first-match behavior", () => {
		const shortcutItems = renderShortcutItems<string>(
			[
				{
					type: "key",
					mapping: { y: { label: "Yes", value: "yes" } },
				},
				{
					type: "auto-list",
					order: [{ label: "Duplicate Y", value: "duplicate-y" }],
				},
			],
			0,
		);
		const lookup = buildDirectShortcutLookup(shortcutItems);
		const selected: string[] = [];

		expect(
			handleDirectShortcutLookup("Y", lookup, (item) => {
				selected.push(item.value);
			}),
		).toBe(true);
		expect(handleDirectShortcutLookup("pasted", lookup, () => undefined)).toBe(
			false,
		);
		expect(selected).toEqual(["yes"]);
	});

	it("keeps legacy direct shortcut helper using normalized shortcuts", () => {
		const shortcutItems = renderShortcutItems<string>(
			[
				{
					type: "key",
					mapping: { y: { label: "Yes", value: "yes" } },
				},
			],
			0,
		);
		const selected: string[] = [];

		expect(
			handleDirectShortcut("Y", shortcutItems, (item) => {
				selected.push(item.value);
			}),
		).toBe(true);
		expect(handleDirectShortcut("pasted", shortcutItems, () => undefined)).toBe(
			false,
		);
		expect(selected).toEqual(["yes"]);
	});

	it("does not render or select blank shortcut labels", () => {
		const shortcutItems = renderShortcutItems<string>(
			[
				{
					type: "key",
					mapping: {
						y: { label: "  ", value: "blank-key" },
						n: { label: "No", value: "no" },
					},
				},
				{
					type: "auto-list",
					order: [
						{ label: "", value: "blank-list" },
						{ label: "Visible", value: "visible" },
					],
				},
			],
			0,
		);
		const selected: string[] = [];
		const lookup = buildDirectShortcutLookup(shortcutItems);

		expect(shortcutItems.map((item) => item.item.value)).toEqual([
			"no",
			"visible",
		]);
		expect(handleDirectShortcutLookup("y", lookup, () => undefined)).toBe(
			false,
		);
		expect(
			handleDirectShortcutLookup("0", lookup, (item) => {
				selected.push(item.value);
			}),
		).toBe(true);
		expect(selected).toEqual(["visible"]);
	});

	it("uses direct lookup for page navigation shortcuts", () => {
		const shortcutItems = renderShortcutItems<string>(
			[
				{
					type: "auto-list",
					order: Array.from({ length: 12 }, (_, index) => ({
						label: `Item ${index}`,
						value: `item-${index}`,
					})),
				},
			],
			0,
		);
		const lookup = buildDirectShortcutLookup(shortcutItems);
		let nextPage = 0;
		let selectedIndex = 1;

		expect(
			handlePageShortcutLookup(
				"l",
				lookup,
				0,
				(update) => {
					nextPage = typeof update === "function" ? update(0) : update;
				},
				(update) => {
					selectedIndex = typeof update === "function" ? update(1) : update;
				},
			),
		).toBe(true);
		expect(nextPage).toBe(1);
		expect(selectedIndex).toBe(0);
		expect(
			handlePageShortcutLookup(
				"h",
				lookup,
				0,
				() => undefined,
				() => undefined,
			),
		).toBe(false);
	});

	it("paginates auto-list shortcuts by visible labels only", () => {
		const order = [
			{ label: "", value: "blank-start" },
			...Array.from({ length: 10 }, (_, index) => ({
				label: `Visible ${index}`,
				value: `visible-${index}`,
			})),
			{ label: " ", value: "blank-end" },
		] satisfies Array<{ label: string; value: string }>;
		const shortcutItems = [
			{ type: "auto-list", order },
		] satisfies ShortcutArray<string>;

		expect(clampShortcutPage(shortcutItems, 1)).toBe(0);
		expect(
			renderShortcutItems(shortcutItems, 0).map((item) => item.item.value),
		).toEqual(Array.from({ length: 10 }, (_, index) => `visible-${index}`));
	});

	it("clamps non-finite shortcut pages to a renderable page", () => {
		const shortcutItems: ShortcutArray<string> = [
			{
				type: "auto-list",
				order: Array.from({ length: 12 }, (_, index) => ({
					label: `Item ${index}`,
					value: `item-${index}`,
				})),
			},
		];

		expect(clampShortcutPage(shortcutItems, Number.NaN)).toBe(0);
		expect(clampShortcutPage(shortcutItems, Number.POSITIVE_INFINITY)).toBe(1);
	});

	it("short-circuits shortcut equality for identical arrays and nested entries", () => {
		const keyMapping = { y: { label: "Yes", value: "yes" } };
		const listItems = [{ label: "Only", value: "only" }];
		const shortcutItems = [
			{ type: "key", mapping: keyMapping },
			{ type: "auto-list", order: listItems },
		] satisfies ShortcutArray<string>;

		expect(shortcutArraysEqual(shortcutItems, shortcutItems)).toBe(true);
		expect(
			shortcutArraysEqual(shortcutItems, [
				{ type: "key", mapping: keyMapping },
				{ type: "auto-list", order: listItems },
			]),
		).toBe(true);
	});
});

describe("KbShortcutSelect", () => {
	it("renders static shortcut labels", () => {
		const { lastFrame } = render(
			<KbShortcutSelect
				shortcutItems={[
					{
						type: "key",
						mapping: {
							y: { label: "Accept", value: "accept" },
							n: { label: "Reject", value: "reject" },
						},
					},
				]}
				onSelect={() => undefined}
			/>,
		);

		const output = lastFrame() || "";
		expect(output).toContain("Accept");
		expect(output).toContain("Reject");
		expect(output).toContain("(y)");
		expect(output).toContain("(n)");
	});

	it("normalizes CR line breaks in visible shortcut labels", () => {
		const { lastFrame } = render(
			<KbShortcutSelect
				shortcutItems={[
					{
						type: "key",
						mapping: {
							y: { label: "Accept\r\nNow", value: "accept" },
							n: { label: "Reject\rLater", value: "reject" },
						},
					},
				]}
				onSelect={() => undefined}
			/>,
		);

		const output = lastFrame() || "";
		expect(output).toContain("Accept");
		expect(output).toContain("Now");
		expect(output).toContain("Reject");
		expect(output).toContain("Later");
		expect(output).not.toContain("\r");
	});

	it("renders numeric shortcuts for auto-list items", () => {
		const { lastFrame } = render(
			<KbShortcutSelect
				shortcutItems={[
					{
						type: "auto-list",
						order: [
							{ label: "First", value: "first" },
							{ label: "Second", value: "second" },
						],
					},
				]}
				onSelect={() => undefined}
			/>,
		);

		const output = lastFrame() || "";
		expect(output).toContain("0:");
		expect(output).toContain("First");
		expect(output).toContain("1:");
		expect(output).toContain("Second");
	});

	it("pages auto-list items and selects visible numeric entries", async () => {
		const selected: string[] = [];
		const { lastFrame, stdin } = render(
			<KbShortcutSelect
				shortcutItems={[
					{
						type: "auto-list",
						order: Array.from({ length: 12 }, (_, index) => ({
							label: `Item ${index}`,
							value: `item-${index}`,
						})),
					},
				]}
				onSelect={(item) => selected.push(item.value)}
			/>,
		);

		expect(lastFrame() ?? "").toContain("Next page");
		stdin.write("l");
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(lastFrame() ?? "").toContain("Previous page");
		expect(lastFrame() ?? "").toContain("Item 10");
		stdin.write("1");

		expect(selected).toEqual(["item-11"]);
	});

	it("clamps stale pages when shortcut items shrink", async () => {
		const selected: string[] = [];
		const instance = render(
			<KbShortcutSelect
				shortcutItems={[
					{
						type: "auto-list",
						order: Array.from({ length: 12 }, (_, index) => ({
							label: `Item ${index}`,
							value: `item-${index}`,
						})),
					},
				]}
				onSelect={(item) => selected.push(item.value)}
			/>,
		);

		instance.stdin.write("l");
		await waitFor(() => (instance.lastFrame() ?? "").includes("Item 10"));

		instance.rerender(
			<KbShortcutSelect
				shortcutItems={[
					{
						type: "auto-list",
						order: [{ label: "Only item", value: "only" }],
					},
				]}
				onSelect={(item) => selected.push(item.value)}
			/>,
		);

		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("Only item");
		expect(frame).not.toContain("Previous page");
		instance.stdin.write("\r");

		expect(selected).toEqual(["only"]);
	});

	it("keeps selection when shortcut item arrays rerender with equal entries", async () => {
		const selected: string[] = [];
		const renderSelect = () => (
			<KbShortcutSelect
				shortcutItems={[
					{
						type: "auto-list",
						order: [
							{ label: "First", value: "first" },
							{ label: "Second", value: "second" },
						],
					},
				]}
				onSelect={(item) => selected.push(item.value)}
			/>
		);
		const instance = render(renderSelect());

		instance.stdin.write("j");
		await Bun.sleep(1);
		instance.rerender(renderSelect());
		instance.stdin.write("\r");
		await Bun.sleep(1);

		expect(selected).toEqual(["second"]);
	});

	it("uses the latest shortcut selection callback after rerender", async () => {
		const selected: string[] = [];
		const shortcutItems: ShortcutArray<string> = [
			{
				type: "key",
				mapping: { y: { label: "Yes", value: "yes" } },
			},
		];
		const instance = render(
			<KbShortcutSelect
				shortcutItems={shortcutItems}
				onSelect={(item) => selected.push(`first:${item.value}`)}
			/>,
		);

		instance.rerender(
			<KbShortcutSelect
				shortcutItems={shortcutItems}
				onSelect={(item) => selected.push(`second:${item.value}`)}
			/>,
		);
		instance.stdin.write("y");
		await Bun.sleep(0);

		expect(selected).toEqual(["second:yes"]);
	});

	it("matches direct shortcuts case-insensitively without treating pasted text as a shortcut", () => {
		const selected: string[] = [];
		const { stdin } = render(
			<KbShortcutSelect
				shortcutItems={[
					{
						type: "key",
						mapping: { y: { label: "Yes", value: "yes" } },
					},
				]}
				onSelect={(item) => selected.push(item.value)}
			/>,
		);

		stdin.write("YES");
		expect(selected).toEqual([]);

		stdin.write("Y");
		expect(selected).toEqual(["yes"]);
	});

	it("ignores duplicate selections while an async selection is pending", async () => {
		const selected: string[] = [];
		const first = deferred<void>();
		const { stdin } = render(
			<KbShortcutSelect
				shortcutItems={[
					{
						type: "key",
						mapping: { y: { label: "Yes", value: "yes" } },
					},
				]}
				onSelect={(item) => {
					selected.push(item.value);
					return first.promise;
				}}
			/>,
		);

		stdin.write("y");
		stdin.write("y");
		await Bun.sleep(1);
		expect(selected).toEqual(["yes"]);

		first.resolve();
		await waitFor(() => selected.length === 1);
		stdin.write("y");

		await waitFor(() => selected.length === 2);
		expect(selected).toEqual(["yes", "yes"]);
	});

	it("ignores duplicate selections while a function thenable is pending", async () => {
		const selected: string[] = [];
		const pending = deferred<void>();
		const functionThenable = Object.assign(() => undefined, {
			// biome-ignore lint/suspicious/noThenProperty: coverage needs a function-shaped thenable.
			then: pending.promise.then.bind(pending.promise),
		});
		const { stdin } = render(
			<KbShortcutSelect
				shortcutItems={[
					{
						type: "key",
						mapping: { y: { label: "Yes", value: "yes" } },
					},
				]}
				onSelect={(item) => {
					selected.push(item.value);
					return functionThenable;
				}}
			/>,
		);

		stdin.write("y");
		stdin.write("y");
		await Bun.sleep(1);
		expect(selected).toEqual(["yes"]);

		pending.resolve();
		await Bun.sleep(1);
		stdin.write("y");
		await waitFor(() => selected.length === 2);
		expect(selected).toEqual(["yes", "yes"]);
	});

	it("does not rerender one-item auto lists for no-op movement", async () => {
		let updateCommits = 0;
		const selected: string[] = [];
		const { stdin, lastFrame } = render(
			<React.Profiler
				id="shortcut-select"
				onRender={(_id, phase) => {
					if (phase === "update") updateCommits += 1;
				}}
			>
				<KbShortcutSelect
					shortcutItems={[
						{
							type: "auto-list",
							order: [{ label: "Only", value: "only" }],
						},
					]}
					onSelect={(item) => selected.push(item.value)}
				/>
			</React.Profiler>,
		);
		await Bun.sleep(1);
		updateCommits = 0;

		stdin.write("j");
		await Bun.sleep(1);
		stdin.write("k");
		await Bun.sleep(1);

		expect(lastFrame() ?? "").toContain("Only");
		expect(selected).toEqual([]);
		expect(updateCommits).toBe(0);
	});

	it("ignores movement and submit on empty lists", () => {
		const selected: string[] = [];
		const { lastFrame, stdin } = render(
			<KbShortcutSelect<string>
				shortcutItems={[{ type: "auto-list", order: [] }]}
				onSelect={(item) => selected.push(item.value)}
			/>,
		);

		stdin.write("j");
		stdin.write("\r");

		expect(lastFrame() ?? "").toBe("");
		expect(selected).toEqual([]);
	});
});

describe("KbShortcutPanel", () => {
	it("renders a titled shortcut panel with centered body content", () => {
		const { lastFrame } = render(
			<KbShortcutPanel
				title={"Panel title\r\ncontinued"}
				shortcutItems={[
					{
						type: "key",
						mapping: { q: { label: "Quit", value: "quit" } },
					},
				]}
				onSelect={() => undefined}
			>
				<Text>Panel body</Text>
			</KbShortcutPanel>,
		);

		const output = lastFrame() || "";
		expect(output).toContain("🐙");
		expect(output).toContain("Panel title");
		expect(output).toContain("continued");
		expect(output).not.toContain("\r");
		expect(output).toContain("Panel body");
		expect(output).toContain("Quit");
	});
});

describe("ConfirmDialog", () => {
	it("renders confirm and reject shortcut labels", () => {
		const { lastFrame } = render(
			<ConfirmDialog
				confirmLabel="Yes"
				rejectLabel="No"
				onConfirm={() => undefined}
				onReject={() => undefined}
			/>,
		);

		const output = lastFrame() || "";
		expect(output).toContain("Yes");
		expect(output).toContain("No");
		expect(output).toContain("(y)");
		expect(output).toContain("(n)");
	});

	it("uses the latest confirm and reject callbacks after rerender", () => {
		const calls: string[] = [];
		const instance = render(
			<ConfirmDialog
				confirmLabel="Yes"
				rejectLabel="No"
				onConfirm={() => calls.push("old-confirm")}
				onReject={() => calls.push("old-reject")}
			/>,
		);
		instance.rerender(
			<ConfirmDialog
				confirmLabel="Yes"
				rejectLabel="No"
				onConfirm={() => calls.push("new-confirm")}
				onReject={() => calls.push("new-reject")}
			/>,
		);

		instance.stdin.write("y");

		expect(calls).toEqual(["new-confirm"]);
	});
});
