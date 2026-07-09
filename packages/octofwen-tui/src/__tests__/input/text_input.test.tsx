import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";
import { TerminalSizeProvider } from "../../layout/viewport.tsx";

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const SPLIT_CRLF_CURSOR_PATTERN = new RegExp(
	`\\r${String.fromCharCode(27)}\\[[0-9;]*m\\n`,
);

function stripAnsi(value: string): string {
	return value.replace(ANSI_PATTERN, "");
}

async function waitForTextInputTest(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Timed out waiting for text input condition");
}

describe("TextInput", () => {
	it("uses provided terminal width before layout measurement", async () => {
		const { TextInput } = await import("../../input/text.ts");
		const { lastFrame } = render(
			<TerminalSizeProvider size={{ width: 10, height: 10 }}>
				<TextInput
					value="12345678901234567890"
					onChange={() => undefined}
					showCursor={false}
				/>
			</TerminalSizeProvider>,
		);

		expect(stripAnsi(lastFrame() ?? "")).toBe("1234567890\n1234567890");
	});
	it("masks API-key input by grapheme count without leaking UTF-16 length", async () => {
		const { buildTextInputRenderModel, maskedText } = await import(
			"../../input/text_editing/text-input-rendering.tsx"
		);

		expect(maskedText("a🙂é❤️🇪🇪", "•")).toBe("•••••");

		const renderModel = buildTextInputRenderModel({
			attachedImageCount: 0,
			showLoadingImageBadge: false,
			measuredWidth: 80,
			mask: "•",
			originalValue: "a🙂é❤️🇪🇪",
			renderCursorPosition: "a🙂é❤️🇪🇪".length,
			placeholder: "",
			showCursor: false,
			focus: false,
		});

		expect(renderModel.lines).toEqual(["•••••"]);
	});

	it("keeps masked cursors aligned for multi-character masks", async () => {
		const { buildTextInputRenderModel } = await import(
			"../../input/text_editing/text-input-rendering.tsx"
		);

		const renderModel = buildTextInputRenderModel({
			attachedImageCount: 0,
			showLoadingImageBadge: false,
			measuredWidth: 80,
			mask: "<>",
			originalValue: "🙂a",
			renderCursorPosition: "🙂a".length,
			placeholder: "",
			showCursor: true,
			focus: true,
		});

		expect(stripAnsi(renderModel.lines[0] ?? "")).toBe("<><> ");
	});

	it("keeps masked stale cursors on grapheme boundaries", async () => {
		const { buildTextInputRenderModel } = await import(
			"../../input/text_editing/text-input-rendering.tsx"
		);

		const renderModel = buildTextInputRenderModel({
			attachedImageCount: 0,
			showLoadingImageBadge: false,
			measuredWidth: 80,
			mask: "•",
			originalValue: "🙂a",
			renderCursorPosition: 1,
			placeholder: "",
			showCursor: true,
			focus: true,
		});

		expect(stripAnsi(renderModel.lines[0] ?? "")).toBe("••");
	});

	it("does not split surrogate-pair placeholders under the cursor", async () => {
		const { renderCursorText } = await import(
			"../../input/text_editing/text-input-cursor-rendering.ts"
		);

		const rendered = renderCursorText({
			wrapped: "",
			wrappedCursorPosition: 0,
			placeholder: "🙂 prompt",
			showCursor: true,
			focus: true,
			value: "",
		});

		expect(stripAnsi(rendered)).toBe("🙂 prompt");
		expect(stripAnsi(rendered)).not.toContain("�");
	});

	it("does not split grapheme-cluster placeholders under the cursor", async () => {
		const { renderCursorText } = await import(
			"../../input/text_editing/text-input-cursor-rendering.ts"
		);

		const rendered = renderCursorText({
			wrapped: "",
			wrappedCursorPosition: 0,
			placeholder: "❤️ prompt",
			showCursor: true,
			focus: true,
			value: "",
		});

		expect(stripAnsi(rendered)).toBe("❤️ prompt");
		expect(stripAnsi(rendered)).not.toContain("�");
	});

	it("does not split graphemes when a stale cursor points inside one", async () => {
		const { renderCursorText } = await import(
			"../../input/text_editing/text-input-cursor-rendering.ts"
		);

		for (const value of ["🙂x", "éx"]) {
			const rendered = renderCursorText({
				wrapped: value,
				wrappedCursorPosition: 1,
				placeholder: "",
				showCursor: true,
				focus: true,
				value,
			});

			expect(stripAnsi(rendered)).toBe(value);
			expect(stripAnsi(rendered)).not.toContain("�");
		}
	});

	it("renders cursors on CRLF and CR separated input without duplicating text", async () => {
		const { renderCursorText } = await import(
			"../../input/text_editing/text-input-cursor-rendering.ts"
		);

		const crlfInput = "alpha\r\nbeta";
		const crInput = "alpha\rbeta";
		const crlfBreakPosition = "alpha\r".length;

		expect(
			stripAnsi(
				renderCursorText({
					wrapped: crlfInput,
					wrappedCursorPosition: "alpha\r\n".length,
					placeholder: "",
					showCursor: true,
					focus: true,
					value: crlfInput,
				}),
			),
		).toBe(crlfInput);
		expect(
			stripAnsi(
				renderCursorText({
					wrapped: crlfInput,
					wrappedCursorPosition: crlfBreakPosition,
					placeholder: "",
					showCursor: true,
					focus: true,
					value: crlfInput,
				}),
			),
		).toBe(crlfInput);
		expect(
			stripAnsi(
				renderCursorText({
					wrapped: crInput,
					wrappedCursorPosition: "alpha\r".length,
					placeholder: "",
					showCursor: true,
					focus: true,
					value: crInput,
				}),
			),
		).toBe(crInput);
		const renderedSplitCrLfCursor = renderCursorText({
			wrapped: crlfInput,
			wrappedCursorPosition: crlfBreakPosition,
			placeholder: "",
			showCursor: true,
			focus: true,
			value: crlfInput,
		});
		expect(renderedSplitCrLfCursor).not.toMatch(SPLIT_CRLF_CURSOR_PATTERN);
	});

	it("moves and deletes by grapheme cluster boundaries", async () => {
		const { nextTextBoundary, previousTextBoundary } = await import(
			"../../input/text.ts"
		);

		expect(nextTextBoundary("abc", 1)).toBe(2);
		expect(previousTextBoundary("abc", 2)).toBe(1);
		expect(nextTextBoundary("éx", 0)).toBe(2);
		expect(previousTextBoundary("éx", 2)).toBe(0);
		expect(nextTextBoundary("❤️x", 0)).toBe(2);
		expect(previousTextBoundary("❤️x", 2)).toBe(0);
		expect(nextTextBoundary("👨‍👩x", 0)).toBe(5);
		expect(previousTextBoundary("👨‍👩x", 5)).toBe(0);
		expect(nextTextBoundary("👍🏽x", 0)).toBe(4);
		expect(previousTextBoundary("👍🏽x", 4)).toBe(0);
		expect(nextTextBoundary("🇪🇪x", 0)).toBe(4);
		expect(previousTextBoundary("🇪🇪x", 4)).toBe(0);
		expect(nextTextBoundary("🇪🇪🇺x", 4)).toBe(6);
		expect(previousTextBoundary("🇪🇪🇺x", 6)).toBe(4);
		expect(previousTextBoundary("🇪🇪🇺x", 4)).toBe(0);
		expect(nextTextBoundary("a\r\nb", 1)).toBe(3);
		expect(previousTextBoundary("a\r\nb", 3)).toBe(1);
	});

	it("does not split surrogate pairs when deleting before the cursor", async () => {
		const { TextInput } = await import("../../input/text.ts");
		let latestValue = "";
		function Probe() {
			const [value, setValue] = React.useState("🙂a");
			latestValue = value;
			return React.createElement(TextInput, {
				value,
				onChange: (nextValue) => {
					latestValue = nextValue;
					setValue(nextValue);
				},
			});
		}

		const instance = render(React.createElement(Probe));
		await Bun.sleep(1);
		instance.stdin.write("\x1b[D");
		await Bun.sleep(1);
		instance.stdin.write("\x7f");
		await Bun.sleep(1);

		expect(latestValue).toBe("a");
	});

	it("does not split surrogate pairs during emacs character deletion", async () => {
		const { TextInput } = await import("../../input/text.ts");
		let latestValue = "";
		function Probe() {
			const [value, setValue] = React.useState("🙂a");
			latestValue = value;
			return React.createElement(TextInput, {
				value,
				onChange: (nextValue) => {
					latestValue = nextValue;
					setValue(nextValue);
				},
			});
		}

		const instance = render(React.createElement(Probe));
		await Bun.sleep(1);
		instance.stdin.write("\x1b[D");
		await Bun.sleep(1);
		instance.stdin.write("\x08");
		await Bun.sleep(1);

		expect(latestValue).toBe("a");
	});

	it("does not split surrogate pairs during emacs forward deletion", async () => {
		const { TextInput } = await import("../../input/text.ts");
		let latestValue = "";
		function Probe() {
			const [value, setValue] = React.useState("🙂a");
			latestValue = value;
			return React.createElement(TextInput, {
				value,
				onChange: (nextValue) => {
					latestValue = nextValue;
					setValue(nextValue);
				},
			});
		}

		const instance = render(React.createElement(Probe));
		await Bun.sleep(1);
		instance.stdin.write("\x1b[D");
		await Bun.sleep(1);
		instance.stdin.write("\x1b[D");
		await Bun.sleep(1);
		instance.stdin.write("\x04");
		await Bun.sleep(1);

		expect(latestValue).toBe("a");
	});

	it("uses the latest change callback after rerender", async () => {
		const { TextInput } = await import("../../input/text.ts");
		const changes: string[] = [];
		const instance = render(
			React.createElement(TextInput, {
				value: "",
				onChange: (nextValue: string) => changes.push(`first:${nextValue}`),
			}),
		);

		instance.rerender(
			React.createElement(TextInput, {
				value: "",
				onChange: (nextValue: string) => changes.push(`second:${nextValue}`),
			}),
		);
		instance.stdin.write("x");
		await Bun.sleep(1);

		expect(changes).toEqual(["second:x"]);
	});

	it("uses the latest submit callback after rerender", async () => {
		const { TextInput } = await import("../../input/text.ts");
		const submitted: string[] = [];
		const instance = render(
			React.createElement(TextInput, {
				value: "go",
				onChange: () => undefined,
				onSubmit: (value: string) => submitted.push(`first:${value}`),
			}),
		);

		instance.rerender(
			React.createElement(TextInput, {
				value: "go",
				onChange: () => undefined,
				onSubmit: (value: string) => submitted.push(`second:${value}`),
			}),
		);
		instance.stdin.write("\r");
		await Bun.sleep(1);

		expect(submitted).toEqual(["second:go"]);
	});

	it("preserves pasted text containing tab characters", async () => {
		const { TextInput } = await import("../../input/text.ts");
		let latestValue = "";
		function Probe() {
			const [value, setValue] = React.useState("");
			latestValue = value;
			return React.createElement(TextInput, {
				value,
				onChange: (nextValue) => {
					latestValue = nextValue;
					setValue(nextValue);
				},
			});
		}

		const instance = render(React.createElement(Probe));
		await Bun.sleep(1);
		instance.stdin.write("foo\tbar");
		await Bun.sleep(1);

		expect(latestValue).toBe("foo\tbar");
	});

	it("preserves pasted whitespace when image attachments are enabled", async () => {
		const { TextInput } = await import("../../input/text.ts");
		let latestValue = "";
		const attachedPaths: string[][] = [];
		function Probe() {
			const [value, setValue] = React.useState("");
			latestValue = value;
			return React.createElement(TextInput, {
				value,
				modalities: {
					image: { enabled: true, maxSizeMB: 1, acceptedMimeTypes: [] },
				},
				onImagePathsAttached: (paths) => {
					attachedPaths.push(paths);
				},
				onChange: (nextValue) => {
					latestValue = nextValue;
					setValue(nextValue);
				},
			});
		}

		const instance = render(React.createElement(Probe));
		await Bun.sleep(1);
		instance.stdin.write("  ");
		await Bun.sleep(1);

		expect(latestValue).toBe("  ");
		expect(attachedPaths).toEqual([]);
	});

	it("submits pasted multiline text without trimming copy-sensitive whitespace", async () => {
		const { TextInput } = await import("../../input/text.ts");
		let latestValue = "";
		let submitted = "";
		function Probe() {
			const [value, setValue] = React.useState("");
			latestValue = value;
			return React.createElement(TextInput, {
				value,
				onChange: (nextValue) => {
					latestValue = nextValue;
					setValue(nextValue);
				},
				onSubmit: (nextValue) => {
					submitted = nextValue;
				},
			});
		}

		const instance = render(React.createElement(Probe));
		await Bun.sleep(1);
		instance.stdin.write("  lead\r\ntrail  \r  both  ");
		await Bun.sleep(1);
		instance.stdin.write("\r");
		await Bun.sleep(1);

		expect(latestValue).toBe("  lead\ntrail  \n  both  ");
		expect(submitted).toBe("  lead\ntrail  \n  both  ");
	});

	it("pastes image-looking paths as text when image attachments are disabled", async () => {
		const { TextInput } = await import("../../input/text.ts");
		let latestValue = "";
		const attachedPaths: string[][] = [];
		function Probe() {
			const [value, setValue] = React.useState("");
			latestValue = value;
			return React.createElement(TextInput, {
				value,
				modalities: {
					image: { enabled: false, maxSizeMB: 1, acceptedMimeTypes: [] },
				},
				onImagePathsAttached: (paths) => {
					attachedPaths.push(paths);
				},
				onChange: (nextValue) => {
					latestValue = nextValue;
					setValue(nextValue);
				},
			});
		}

		const instance = render(React.createElement(Probe));
		await Bun.sleep(1);
		instance.stdin.write("/tmp/screenshot.png");
		await Bun.sleep(1);

		expect(latestValue).toBe("/tmp/screenshot.png");
		expect(attachedPaths).toEqual([]);
	});

	it("renders multiline cursor movement without duplicating copied text", async () => {
		const { TextInput } = await import("../../input/text.ts");
		const instance = render(
			React.createElement(TextInput, {
				value: "alpha\nbeta\ngamma",
				onChange: () => undefined,
			}),
		);

		await Bun.sleep(1);
		for (let index = 0; index < 7; index += 1) {
			instance.stdin.write("\x1b[D");
		}
		await Bun.sleep(1);

		expect(stripAnsi(instance.lastFrame() ?? "")).toContain(
			"alpha\nbeta\ngamma",
		);
	});

	it("moves across CRLF as one line break without exposing split-newline cursor states", async () => {
		const { TextInput } = await import("../../input/text.ts");
		const instance = render(
			React.createElement(TextInput, {
				value: "alpha\r\nbeta",
				onChange: () => undefined,
			}),
		);

		await Bun.sleep(1);
		for (let index = 0; index < 5; index += 1) {
			instance.stdin.write("\x1b[D");
		}
		await Bun.sleep(1);
		instance.stdin.write("\x1b[C");
		await Bun.sleep(1);

		expect(stripAnsi(instance.lastFrame() ?? "")).toContain("alpha\nbeta");
		expect(stripAnsi(instance.lastFrame() ?? "")).not.toContain("\r");
	});

	it("does not rerender for no-op emacs cursor moves", async () => {
		const { TextInput } = await import("../../input/text.ts");
		let updateCommits = 0;

		const instance = render(
			React.createElement(
				React.Profiler,
				{
					id: "text-input",
					onRender: (_id, phase) => {
						if (phase === "update") updateCommits += 1;
					},
				},
				React.createElement(TextInput, {
					value: "",
					onChange: () => undefined,
				}),
			),
		);
		await Bun.sleep(1);
		updateCommits = 0;

		instance.stdin.write("\x01");
		await Bun.sleep(1);

		expect(updateCommits).toBe(0);
	});

	it("clamps stale cursor offsets after controlled value shrinks", async () => {
		const { TextInput } = await import("../../input/text.ts");
		let latestValue = "abcdef";
		function Probe({ value }: { value: string }) {
			const [localValue, setLocalValue] = React.useState(value);
			React.useLayoutEffect(() => {
				latestValue = value;
				setLocalValue(value);
			}, [value]);
			latestValue = localValue;
			return React.createElement(TextInput, {
				value: localValue,
				onChange: (nextValue) => {
					latestValue = nextValue;
					setLocalValue(nextValue);
				},
			});
		}

		const instance = render(React.createElement(Probe, { value: "abcdef" }));
		await Bun.sleep(1);
		for (let index = 0; index < 4; index += 1) {
			instance.stdin.write("\x1b[D");
		}
		await Bun.sleep(1);
		instance.rerender(React.createElement(Probe, { value: "x" }));
		await waitForTextInputTest(() => {
			const frame = stripAnsi(instance.lastFrame() ?? "");
			return (
				latestValue === "x" && frame.includes("x") && !frame.includes("abcdef")
			);
		});
		instance.stdin.write("y");
		instance.stdin.write("z");
		await waitForTextInputTest(() => latestValue === "yzx");

		expect(latestValue).toBe("yzx");
	});

	it("applies rapid emacs edits to the latest text value", async () => {
		const { TextInput } = await import("../../input/text.ts");
		let latestValue = "";
		function Probe() {
			const [value, setValue] = React.useState("abc");
			latestValue = value;
			return React.createElement(TextInput, {
				value,
				onChange: (nextValue) => {
					latestValue = nextValue;
					setValue(nextValue);
				},
			});
		}

		const instance = render(React.createElement(Probe));
		await Bun.sleep(1);
		instance.stdin.write("\x08");
		instance.stdin.write("\x08");
		await Bun.sleep(1);

		expect(latestValue).toBe("a");
	});
});
