import { describe, expect, it } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import React from "react";
import {
	SelectInput,
	ThemedSelectIndicator,
	ThemedSelectItem,
} from "../../menu/select.tsx";

describe("SelectInput", () => {
	it("renders visible selectable labels", () => {
		const { lastFrame } = render(
			<SelectInput
				items={[
					{ label: "First", value: "first" },
					{ label: "Second", value: "second" },
				]}
			/>,
		);

		const output = lastFrame() || "";
		expect(output).toContain("First");
		expect(output).toContain("Second");
	});

	it("normalizes CR line breaks in selectable labels", () => {
		const { lastFrame } = render(
			<SelectInput
				items={[{ label: "First\r\nSecond\rThird", value: "value" }]}
			/>,
		);

		const output = lastFrame() || "";
		expect(output).toContain("First");
		expect(output).toContain("Second");
		expect(output).toContain("Third");
		expect(output).not.toContain("\r");
	});

	it("renders duplicate object values without key warnings", () => {
		const errorEntries: unknown[][] = [];
		const originalError = console.error;
		console.error = (...args: unknown[]) => {
			errorEntries.push(args);
		};

		try {
			const { lastFrame } = render(
				<SelectInput
					items={[
						{ label: "First", value: { id: 1 } },
						{ label: "Second", value: { id: 2 } },
					]}
				/>,
			);

			expect(lastFrame() || "").toContain("Second");
		} finally {
			console.error = originalError;
		}

		expect(
			errorEntries.some((entry) =>
				entry.some((part) =>
					String(part).includes("Encountered two children with the same key"),
				),
			),
		).toBe(false);
	});

	it("respects the visible item limit", () => {
		const { lastFrame } = render(
			<SelectInput
				limit={2}
				items={[
					{ label: "One", value: "one" },
					{ label: "Two", value: "two" },
					{ label: "Three", value: "three" },
				]}
			/>,
		);

		const output = lastFrame() || "";
		expect(output).toContain("One");
		expect(output).toContain("Two");
		expect(output).not.toContain("Three");
	});

	it("selects visible numbered items after scrolling a limited list", async () => {
		const selected: string[] = [];
		const instance = render(
			<SelectInput
				limit={2}
				items={[
					{ label: "One", value: "one" },
					{ label: "Two", value: "two" },
					{ label: "Three", value: "three" },
				]}
				onSelect={(item) => selected.push(item.value)}
			/>,
		);

		instance.stdin.write("j");
		await Bun.sleep(0);
		instance.stdin.write("j");
		await Bun.sleep(0);
		instance.stdin.write("2");
		await Bun.sleep(0);

		expect(selected).toEqual(["three"]);
	});

	it("uses the latest select callback after rerender", async () => {
		const selected: string[] = [];
		const items = [{ label: "One", value: "one" }];
		const instance = render(
			<SelectInput
				items={items}
				onSelect={(item) => selected.push(`first:${item.value}`)}
			/>,
		);

		instance.rerender(
			<SelectInput
				items={items}
				onSelect={(item) => selected.push(`second:${item.value}`)}
			/>,
		);
		instance.stdin.write("\r");
		await Bun.sleep(0);

		expect(selected).toEqual(["second:one"]);
	});

	it("uses the latest highlight callback after rerender", async () => {
		const highlighted: string[] = [];
		const items = [
			{ label: "One", value: "one" },
			{ label: "Two", value: "two" },
		];
		const instance = render(
			<SelectInput
				items={items}
				onHighlight={(item) => highlighted.push(`first:${item.value}`)}
			/>,
		);

		instance.rerender(
			<SelectInput
				items={items}
				onHighlight={(item) => highlighted.push(`second:${item.value}`)}
			/>,
		);
		instance.stdin.write("j");
		await Bun.sleep(0);

		expect(highlighted).toEqual(["second:two"]);
	});

	it("ignores non-selecting numeric input", async () => {
		const selected: string[] = [];
		const instance = render(
			<SelectInput
				items={[{ label: "One", value: "one" }]}
				onSelect={(item) => selected.push(item.value)}
			/>,
		);

		instance.stdin.write("0");
		await Bun.sleep(0);

		expect(selected).toEqual([]);
	});

	it("wraps upward through a limited list without changing visible whitespace", async () => {
		const highlighted: string[] = [];
		const instance = render(
			<SelectInput
				limit={2}
				items={[
					{ label: "One", value: "one" },
					{ label: "Two", value: "two" },
					{ label: "Three", value: "three" },
				]}
				onHighlight={(item) => highlighted.push(item.value)}
			/>,
		);

		const before = instance.lastFrame();
		instance.stdin.write("k");
		await Bun.sleep(0);
		const after = instance.lastFrame();

		expect(highlighted).toEqual(["three"]);
		expect(before).toContain("One");
		expect(before).toContain("Two");
		expect(after).toContain("Three");
		expect(after).toContain("One");
		expect(after?.split("\n")).toHaveLength(before?.split("\n").length ?? 0);
	});

	it("keeps selection across parent rerenders with equivalent primitive values", async () => {
		const selected: string[] = [];
		function Probe() {
			const [label, setLabel] = React.useState("Second");
			return (
				<SelectInput
					items={[
						{ label: "First", value: "first" },
						{ label, value: "second" },
					]}
					onHighlight={(item) => {
						if (item.value === "second") setLabel("Second updated");
					}}
					onSelect={(item) => selected.push(item.value)}
				/>
			);
		}

		const instance = render(<Probe />);
		instance.stdin.write("j");
		await Bun.sleep(1);
		instance.stdin.write("\r");
		await Bun.sleep(1);

		expect(instance.lastFrame() ?? "").toContain("Second updated");
		expect(selected).toEqual(["second"]);
	});

	it("keeps selection across rerenders with equivalent keyed object values", async () => {
		const selected: Array<{ id: number }> = [];
		const renderSelect = (label: string) => (
			<SelectInput
				items={[
					{ key: "first", label: "First", value: { id: 1 } },
					{ key: "second", label, value: { id: 2 } },
				]}
				onSelect={(item) => selected.push(item.value)}
			/>
		);
		const instance = render(renderSelect("Second"));

		instance.stdin.write("j");
		await Bun.sleep(1);
		instance.rerender(renderSelect("Second updated"));
		instance.stdin.write("\r");
		await Bun.sleep(1);

		expect(instance.lastFrame() ?? "").toContain("Second updated");
		expect(selected).toEqual([{ id: 2 }]);
	});

	it("resets rendered selection immediately when item values change", async () => {
		const selected: string[] = [];
		function TestIndicator({ isSelected = false }: { isSelected?: boolean }) {
			return <Text>{isSelected ? ">" : " "}</Text>;
		}
		function TestItem({ label }: { label: string }) {
			return <Text>{label}</Text>;
		}

		const instance = render(
			<SelectInput
				items={[
					{ label: "Alpha", value: "alpha" },
					{ label: "Beta", value: "beta" },
				]}
				indicatorComponent={TestIndicator}
				itemComponent={TestItem}
				onSelect={(item) => selected.push(item.value)}
			/>,
		);

		instance.stdin.write("j");
		await Bun.sleep(0);
		expect(instance.lastFrame() ?? "").toContain(">Beta");

		instance.rerender(
			<SelectInput
				items={[
					{ label: "Gamma", value: "gamma" },
					{ label: "Delta", value: "delta" },
				]}
				indicatorComponent={TestIndicator}
				itemComponent={TestItem}
				onSelect={(item) => selected.push(item.value)}
			/>,
		);

		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain(">Gamma");
		expect(frame).not.toContain(">Delta");

		instance.stdin.write("\r");
		await Bun.sleep(0);
		expect(selected).toEqual(["gamma"]);
	});

	it("does not rerender or re-highlight when one-item movement is a no-op", async () => {
		let updateCommits = 0;
		const highlighted: string[] = [];
		const instance = render(
			<React.Profiler
				id="single-select"
				onRender={(_id, phase) => {
					if (phase === "update") updateCommits += 1;
				}}
			>
				<SelectInput
					items={[{ label: "Only", value: "only" }]}
					onHighlight={(item) => highlighted.push(item.value)}
				/>
			</React.Profiler>,
		);
		await Bun.sleep(1);
		updateCommits = 0;

		instance.stdin.write("j");
		await Bun.sleep(1);
		instance.stdin.write("k");
		await Bun.sleep(1);

		expect(instance.lastFrame() ?? "").toContain("Only");
		expect(highlighted).toEqual([]);
		expect(updateCommits).toBe(0);
	});

	it("ignores movement and submit when empty", async () => {
		const selected: string[] = [];
		const highlighted: string[] = [];
		const instance = render(
			<SelectInput<string>
				items={[]}
				onHighlight={(item) => highlighted.push(item.value)}
				onSelect={(item) => selected.push(item.value)}
			/>,
		);

		instance.stdin.write("k");
		await Bun.sleep(0);
		instance.stdin.write("j");
		await Bun.sleep(0);
		instance.stdin.write("\r");
		await Bun.sleep(0);

		expect(instance.lastFrame() ?? "").toBe("");
		expect(highlighted).toEqual([]);
		expect(selected).toEqual([]);
	});

	it("handles zero and fractional limits without invalid selection state", async () => {
		const selected: string[] = [];
		const highlighted: string[] = [];
		const zero = render(
			<SelectInput
				limit={0}
				initialIndex={5}
				items={[{ label: "Hidden", value: "hidden" }]}
				onHighlight={(item) => highlighted.push(item.value)}
				onSelect={(item) => selected.push(item.value)}
			/>,
		);

		expect(zero.lastFrame() ?? "").toBe("");
		zero.stdin.write("j");
		await Bun.sleep(0);
		zero.stdin.write("\r");
		await Bun.sleep(0);

		expect(highlighted).toEqual([]);
		expect(selected).toEqual([]);

		const fractional = render(
			<SelectInput
				limit={1.9}
				items={[
					{ label: "One", value: "one" },
					{ label: "Two", value: "two" },
				]}
			/>,
		);

		const output = fractional.lastFrame() ?? "";
		expect(output).toContain("One");
		expect(output).not.toContain("Two");
	});
});

describe("themed select components", () => {
	it("render selected and unselected item labels", () => {
		const selected = render(
			<ThemedSelectItem isSelected={true} label="Chosen" />,
		);
		const unselected = render(<ThemedSelectItem label="Plain" />);

		expect(selected.lastFrame()).toContain("Chosen");
		expect(unselected.lastFrame()).toContain("Plain");
	});

	it("renders a marker only for selected indicator state", () => {
		const selected = render(<ThemedSelectIndicator isSelected={true} />);
		const unselected = render(<ThemedSelectIndicator isSelected={false} />);

		expect(selected.lastFrame()?.trim().length).toBeGreaterThan(0);
		expect(unselected.lastFrame()?.trim()).toBe("");
	});
});
