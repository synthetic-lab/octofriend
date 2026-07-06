import { describe, expect, it } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import {
	ConfirmDialog,
	KbShortcutPanel,
	KbShortcutSelect,
} from "../../input/shortcuts.tsx";

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
});

describe("KbShortcutPanel", () => {
	it("renders a titled shortcut panel with centered body content", () => {
		const { lastFrame } = render(
			<KbShortcutPanel
				title="Panel title"
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
});
