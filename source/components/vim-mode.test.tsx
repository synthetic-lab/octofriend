import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { PaintKeyboardEvent } from "paintcannon";
import { useVimKeyHandler } from "./vim-mode.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type VimHandler = ReturnType<typeof useVimKeyHandler>;
type HandleResult = ReturnType<VimHandler["handle"]>;
type Rendered = ReturnType<typeof renderVimHandler>;

function renderVimHandler(mode: "NORMAL" | "INSERT", setMode = vi.fn()) {
  let handler: VimHandler | null = null;
  function Harness() {
    handler = useVimKeyHandler(mode, setMode);
    return null;
  }

  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<Harness />);
  });
  return {
    get handler() {
      return handler!;
    },
    setMode,
    unmount() {
      act(() => renderer.unmount());
    },
  };
}

const normalKey = (key: string) =>
  ({
    key,
    ctrlKey: false,
  }) as PaintKeyboardEvent;

const ctrlKey = (key: string) =>
  ({
    key,
    ctrlKey: true,
  }) as PaintKeyboardEvent;

const ctrlC = ctrlKey("c");

// Sends each character of `keys` through the handler as a separate keypress and
// returns the result of the final keypress.
function pressKeys(
  rendered: Rendered,
  keys: string,
  cursorPosition: number,
  text: string,
  visualLineRange: { start: number; end: number } | null = null,
): HandleResult {
  let result: HandleResult = { consumed: false };
  for (const key of keys) {
    result = rendered.handler.handle(
      key,
      normalKey(key),
      cursorPosition,
      text.length,
      text,
      null,
      visualLineRange,
    );
  }
  return result;
}

describe("useVimKeyHandler Ctrl-C handling", () => {
  it("consumes Ctrl-C in Insert mode and returns to Normal mode", () => {
    const rendered = renderVimHandler("INSERT");

    const result = rendered.handler.handle(
      "c",
      ctrlC,
      5,
      5,
      "hello",
      {
        row: 0,
        column: 5,
      },
      { start: 0, end: 5 },
    );

    expect(result).toEqual({ consumed: true, newCursorPosition: 4 });
    expect(rendered.setMode).toHaveBeenCalledWith("NORMAL");
    rendered.unmount();
  });

  it("does not move left from the start of a soft-wrapped visual line", () => {
    const rendered = renderVimHandler("INSERT");

    const result = rendered.handler.handle(
      "c",
      ctrlC,
      6,
      11,
      "hello world",
      {
        row: 1,
        column: 0,
      },
      { start: 6, end: 11 },
    );

    expect(result).toEqual({ consumed: true, newCursorPosition: 6 });
    expect(rendered.setMode).toHaveBeenCalledWith("NORMAL");
    rendered.unmount();
  });

  it("leaves Ctrl-C unconsumed in Normal mode for the app-level exit handler", () => {
    const rendered = renderVimHandler("NORMAL");

    const result = rendered.handler.handle(
      "c",
      ctrlC,
      4,
      5,
      "hello",
      {
        row: 0,
        column: 4,
      },
      { start: 0, end: 5 },
    );

    expect(result).toEqual({ consumed: false });
    expect(rendered.setMode).not.toHaveBeenCalled();
    rendered.unmount();
  });
});

describe("useVimKeyHandler INSERT mode", () => {
  it("leaves regular keys unconsumed", () => {
    const rendered = renderVimHandler("INSERT");

    const result = rendered.handler.handle(
      "a",
      normalKey("a"),
      2,
      5,
      "hello",
      { row: 0, column: 2 },
      { start: 0, end: 5 },
    );

    expect(result).toEqual({ consumed: false });
    expect(rendered.setMode).not.toHaveBeenCalled();
    rendered.unmount();
  });

  it("returns to NORMAL mode and moves the cursor left on Escape", () => {
    const rendered = renderVimHandler("INSERT");

    const result = rendered.handler.handle(
      "Escape",
      normalKey("Escape"),
      5,
      5,
      "hello",
      { row: 0, column: 5 },
      { start: 0, end: 5 },
    );

    expect(result).toEqual({ consumed: true, newCursorPosition: 4 });
    expect(rendered.setMode).toHaveBeenCalledWith("NORMAL");
    rendered.unmount();
  });

  it("keeps the cursor at position 0 on Escape at the start of the buffer", () => {
    const rendered = renderVimHandler("INSERT");

    const result = rendered.handler.handle(
      "Escape",
      normalKey("Escape"),
      0,
      5,
      "hello",
      { row: 0, column: 0 },
      { start: 0, end: 5 },
    );

    expect(result).toEqual({ consumed: true, newCursorPosition: 0 });
    expect(rendered.setMode).toHaveBeenCalledWith("NORMAL");
    rendered.unmount();
  });

  it("does not move the cursor on Escape at the start of an empty line", () => {
    const rendered = renderVimHandler("INSERT");

    const result = rendered.handler.handle(
      "Escape",
      normalKey("Escape"),
      3,
      6,
      "ab\n\ncd",
      { row: 1, column: 0 },
      { start: 3, end: 3 },
    );

    expect(result).toEqual({ consumed: true, newCursorPosition: 3 });
    expect(rendered.setMode).toHaveBeenCalledWith("NORMAL");
    rendered.unmount();
  });
});

describe("useVimKeyHandler basic motions", () => {
  const multi = "one\ntwo\nthree";

  it.each([
    ["h", "hello world", 5, 4],
    ["l", "hello world", 5, 6],
    ["j", multi, 1, 5],
    ["k", multi, 5, 1],
    ["w", "foo bar baz", 0, 4],
    ["w", "foo bar baz", 3, 4],
    ["w", "foo-bar baz", 0, 3],
    ["w", "foo...bar", 0, 3],
    ["w", "foo...bar", 3, 6],
    ["w", "foo\nbar", 0, 4],
    ["w", "a b", 0, 2],
    ["W", "foo-bar baz", 0, 8],
    ["b", "foo bar", 4, 0],
    ["b", "foo-bar baz", 4, 3],
    ["b", "foo\nbar", 4, 0],
    ["b", "a b", 2, 0],
    ["B", "foo-bar baz", 8, 0],
    ["e", "foo bar", 0, 2],
    ["e", "foo bar", 2, 6],
    ["e", "foo  bar", 3, 7],
    ["e", "foo\nbar", 2, 6],
    ["e", "a b", 0, 2],
    // Punctuation is its own word class: "foo.bar" is 3 words
    ["e", "foo.bar", 0, 2],
    ["e", "foo.bar", 2, 3],
    ["e", "foo.bar", 3, 6],
    ["0", "  foo\n  bar", 8, 6],
    ["0", "ab\n\ncd", 3, 3],
    ["$", "  foo\n  bar", 6, 10],
    ["$", "ab\n\ncd", 3, 3],
    ["^", "  foo\n  bar", 10, 8],
    ["^", "  foo", 0, 2],
    ["^", "ab\n  \ncd", 4, 3],
  ])("moves %s in %j from %i to %i", (key, text, from, to) => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, key, from, text);

    expect(result).toEqual({ consumed: true, newCursorPosition: to });
    rendered.unmount();
  });

  it.each([
    ["h", "hello", 0],
    ["h", multi, 4],
    ["l", "hello", 4],
    ["j", multi, 9],
    ["k", multi, 1],
  ])("keeps %s at the buffer edge of %j", (key, text, from) => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, key, from, text);

    expect(result).toEqual({ consumed: true, newCursorPosition: from });
    rendered.unmount();
  });

  it.each([
    ["w", "hello", 4],
    ["w", "", 0],
    ["b", "hello", 0],
    ["e", "hello", 4],
  ])("does not move %s past the buffer edge of %j", (key, text, from) => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, key, from, text);

    expect(result).toEqual({ consumed: true });
    rendered.unmount();
  });

  it("clamps j/k to the end of shorter lines", () => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, "j", 4, "longer\nx");

    expect(result).toEqual({ consumed: true, newCursorPosition: 7 });
    rendered.unmount();
  });

  it.each([
    ["ArrowLeft", "hello", 2, 1],
    ["ArrowRight", "hello", 2, 3],
    ["ArrowDown", "one\ntwo", 1, 5],
    ["ArrowUp", "one\ntwo", 5, 1],
    ["Home", "hello", 2, 0],
    ["End", "hello", 2, 4],
  ])("maps %s to the corresponding vim motion", (key, text, from, to) => {
    const rendered = renderVimHandler("NORMAL");

    const result = rendered.handler.handle(
      key,
      normalKey(key),
      from,
      text.length,
      text,
      null,
      null,
    );

    expect(result).toEqual({ consumed: true, newCursorPosition: to });
    rendered.unmount();
  });

  it.each([
    ["ArrowLeft", 0],
    ["ArrowRight", 2],
  ])("maps Ctrl+%s to word navigation", (key, expectedPosition) => {
    const rendered = renderVimHandler("NORMAL");
    const text = "foo bar";

    const result = rendered.handler.handle(
      key,
      ctrlKey(key),
      key === "ArrowLeft" ? 4 : 0,
      text.length,
      text,
      null,
      null,
    );

    expect(result).toEqual({ consumed: true, newCursorPosition: expectedPosition });
    rendered.unmount();
  });
});

describe("useVimKeyHandler insert-entry commands", () => {
  it.each([
    ["i", "hello", 2, undefined],
    ["a", "hello", 2, 3],
    ["A", "hello\nworld", 0, 5],
    ["I", "  foo\n  bar", 9, 8],
  ])("enters INSERT mode with %s", (key, text, from, expectedPosition) => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, key, from, text);

    expect(result).toEqual(
      expectedPosition === undefined
        ? { consumed: true }
        : { consumed: true, newCursorPosition: expectedPosition },
    );
    expect(rendered.setMode).toHaveBeenCalledWith("INSERT");
    rendered.unmount();
  });

  it("treats a like i on an empty line", () => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, "a", 3, "ab\n\ncd");

    expect(result).toEqual({ consumed: true });
    expect(rendered.setMode).toHaveBeenCalledWith("INSERT");
    rendered.unmount();
  });
});

describe("useVimKeyHandler operators", () => {
  it.each([
    ["dd", "one\ntwo\nthree", 4, "one\nthree", 4],
    // Deleting the last line consumes the preceding newline: no empty line
    // is left behind, and the cursor lands on the first non-blank
    ["dd", "one\ntwo", 4, "one", 0],
    ["dd", "a\n", 2, "a", 0],
    ["dd", "hello", 2, "", 0],
    ["dw", "foo bar baz", 0, "bar baz", 0],
    ["dw", "foo bar", 4, "foo ", 3],
    // Real vim includes the newline when a word motion crosses a line,
    // joining the lines
    ["dw", "foo\nbar", 0, "bar", 0],
    ["db", "foo\nbar", 4, "bar", 0],
    ["de", "foo bar", 0, " bar", 0],
    ["de", "foo.bar", 0, ".bar", 0],
    ["dW", "foo-bar baz", 0, "baz", 0],
    ["d$", "hello world", 5, "hello", 4],
    ["d$", "hello", 4, "hell", 3],
    // D/d$ on the last line empties it, and the cursor rests on the empty line
    ["d$", "one\ntwo", 4, "one\n", 4],
    ["D", "one\ntwo", 4, "one\n", 4],
    ["d0", "hello world", 5, " world", 0],
    ["d^", "  foo", 4, "  o", 2],
    ["cw", "foo bar", 2, "fo bar", 2],
    ["x", "hello", 1, "hllo", 1],
    ["x", "hello", 4, "hell", 3],
  ])("applies %s in %j", (keys, text, from, newValue, newCursorPosition) => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, keys, from, text);

    expect(result).toEqual({ consumed: true, newValue, newCursorPosition });
    rendered.unmount();
  });

  it("changes a word with cw and enters INSERT mode", () => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, "cw", 0, "foo bar");

    expect(result).toEqual({ consumed: true, newValue: " bar", newCursorPosition: 0 });
    expect(rendered.setMode).toHaveBeenCalledWith("INSERT");
    rendered.unmount();
  });

  it("enters INSERT mode without changing the text with cc on an empty line", () => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, "cc", 3, "ab\n\ncd");

    expect(result).toEqual({ consumed: true, newValue: "ab\n\ncd", newCursorPosition: 3 });
    expect(rendered.setMode).toHaveBeenCalledWith("INSERT");
    rendered.unmount();
  });

  it.each([
    ["", 0],
    // x can't delete a newline, so it's a no-op on an empty line
    ["ab\n\ncd", 3],
    // x does nothing at the end of the buffer
    ["ab", 2],
  ])("does nothing with x where there is no character to delete in %j", (text, from) => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, "x", from, text);

    expect(result).toEqual({ consumed: true });
    rendered.unmount();
  });

  it("clears the current line and enters INSERT mode with cc", () => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, "cc", 4, "one\ntwo\nthree");

    expect(result).toEqual({ consumed: true, newValue: "one\n\nthree", newCursorPosition: 4 });
    expect(rendered.setMode).toHaveBeenCalledWith("INSERT");
    rendered.unmount();
  });

  it("clears the last line and enters INSERT mode with cc on the last line", () => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, "cc", 4, "one\ntwo");

    expect(result).toEqual({ consumed: true, newValue: "one\n", newCursorPosition: 4 });
    expect(rendered.setMode).toHaveBeenCalledWith("INSERT");
    rendered.unmount();
  });

  it("changes through the end of the buffer with cG", () => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, "cG", 4, "one\ntwo\nthree");

    expect(result).toEqual({ consumed: true, newValue: "one\n", newCursorPosition: 4 });
    expect(rendered.setMode).toHaveBeenCalledWith("INSERT");
    rendered.unmount();
  });

  it("opens a new line at the end of the buffer with o", () => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, "o", 4, "one\ntwo");

    expect(result).toEqual({ consumed: true, newValue: "one\ntwo\n", newCursorPosition: 8 });
    expect(rendered.setMode).toHaveBeenCalledWith("INSERT");
    rendered.unmount();
  });

  it("opens a new line above the first line with O", () => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, "O", 1, "one\ntwo");

    expect(result).toEqual({ consumed: true, newValue: "\none\ntwo", newCursorPosition: 0 });
    expect(rendered.setMode).toHaveBeenCalledWith("INSERT");
    rendered.unmount();
  });
});

describe("useVimKeyHandler dj and dk", () => {
  const multi = "one\ntwo\nthree";

  it("deletes the current and next line with dj", () => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, "dj", 1, multi);

    expect(result).toEqual({ consumed: true, newValue: "three", newCursorPosition: 0 });
    rendered.unmount();
  });

  it("deletes the current and previous line with dk", () => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, "dk", 4, multi);

    expect(result).toEqual({ consumed: true, newValue: "three", newCursorPosition: 0 });
    rendered.unmount();
  });

  it("deletes only the current line with dj on the last line", () => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, "dj", 10, multi);

    // No empty line is left behind, and vim leaves the cursor on the first
    // non-blank of the surviving line
    expect(result).toEqual({ consumed: true, newValue: "one\ntwo", newCursorPosition: 4 });
    rendered.unmount();
  });

  it("deletes only the current line with dk on the first line", () => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, "dk", 1, multi);

    expect(result).toEqual({ consumed: true, newValue: "two\nthree", newCursorPosition: 0 });
    rendered.unmount();
  });

  it.each([
    ["cj", 1],
    ["ck", 4],
  ])("changes two lines with %s and enters INSERT mode", (keys, from) => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, keys, from, multi);

    expect(result).toEqual({ consumed: true, newValue: "\nthree", newCursorPosition: 0 });
    expect(rendered.setMode).toHaveBeenCalledWith("INSERT");
    rendered.unmount();
  });

  it.each([
    ["ArrowDown", 1],
    ["ArrowUp", 4],
  ])("treats d + %s like dj/dk", (arrow, from) => {
    const rendered = renderVimHandler("NORMAL");

    pressKeys(rendered, "d", from, multi);
    const result = rendered.handler.handle(
      arrow,
      normalKey(arrow),
      from,
      multi.length,
      multi,
      null,
      null,
    );

    expect(result).toEqual({ consumed: true, newValue: "three", newCursorPosition: 0 });
    rendered.unmount();
  });
});

describe("useVimKeyHandler undo and redo", () => {
  it("undoes a change with u", () => {
    const rendered = renderVimHandler("NORMAL");

    pressKeys(rendered, "x", 1, "hello");
    const result = pressKeys(rendered, "u", 1, "hllo");

    expect(result).toEqual({ consumed: true, newValue: "hello", newCursorPosition: 1 });
    rendered.unmount();
  });

  it("redoes a change with Ctrl-r", () => {
    const rendered = renderVimHandler("NORMAL");

    pressKeys(rendered, "x", 1, "hello");
    pressKeys(rendered, "u", 1, "hllo");
    const result = rendered.handler.handle("r", ctrlKey("r"), 1, 5, "hello", null, null);

    expect(result).toEqual({ consumed: true, newValue: "hllo", newCursorPosition: 1 });
    rendered.unmount();
  });

  it("does nothing when there is nothing to undo or redo", () => {
    const rendered = renderVimHandler("NORMAL");

    const undo = pressKeys(rendered, "u", 1, "hello");
    const redo = rendered.handler.handle("r", ctrlKey("r"), 1, 5, "hello", null, null);

    expect(undo).toEqual({ consumed: true });
    expect(redo).toEqual({ consumed: true });
    rendered.unmount();
  });

  it("undoes multiple changes in order", () => {
    const rendered = renderVimHandler("NORMAL");

    pressKeys(rendered, "x", 1, "hello");
    pressKeys(rendered, "x", 1, "hllo");

    const firstUndo = pressKeys(rendered, "u", 1, "hlo");
    const secondUndo = pressKeys(rendered, "u", 1, "hllo");

    expect(firstUndo).toEqual({ consumed: true, newValue: "hllo", newCursorPosition: 1 });
    expect(secondUndo).toEqual({ consumed: true, newValue: "hello", newCursorPosition: 1 });
    rendered.unmount();
  });

  it("clears the redo stack when a new change is made", () => {
    const rendered = renderVimHandler("NORMAL");

    pressKeys(rendered, "x", 1, "hello");
    pressKeys(rendered, "u", 1, "hllo");
    pressKeys(rendered, "x", 1, "hello");

    const redo = rendered.handler.handle("r", ctrlKey("r"), 1, 5, "hello", null, null);

    expect(redo).toEqual({ consumed: true });
    rendered.unmount();
  });
});

describe("useVimKeyHandler pending command edge cases", () => {
  it("cancels a pending operator when the next key is not a motion", () => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, "dz", 1, "hello");

    expect(result).toEqual({ consumed: true });
    expect(rendered.setMode).not.toHaveBeenCalled();
    rendered.unmount();
  });

  it("cancels a pending operator on Escape", () => {
    const rendered = renderVimHandler("NORMAL");

    pressKeys(rendered, "d", 1, "hello");
    const result = rendered.handler.handle(
      "Escape",
      normalKey("Escape"),
      1,
      5,
      "hello",
      null,
      null,
    );

    expect(result).toEqual({ consumed: true });
    expect(rendered.handler.hasPendingCommand()).toBe(false);
    rendered.unmount();
  });

  it("swallows a non-g key after a pending operator and g (dgx)", () => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, "dgx", 1, "one\ntwo");

    expect(result).toEqual({ consumed: true });
    expect(rendered.handler.hasPendingCommand()).toBe(false);
    rendered.unmount();
  });

  it("treats a new operator after a pending operator as a fresh command (dcw)", () => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, "dcw", 0, "foo bar");

    expect(result).toEqual({ consumed: true, newValue: " bar", newCursorPosition: 0 });
    expect(rendered.setMode).toHaveBeenCalledWith("INSERT");
    rendered.unmount();
  });

  it("does not consume Enter in NORMAL mode", () => {
    const rendered = renderVimHandler("NORMAL");

    const result = rendered.handler.handle("Enter", normalKey("Enter"), 1, 5, "hello", null, null);

    expect(result).toEqual({ consumed: false });
    rendered.unmount();
  });

  it("consumes unhandled keys in NORMAL mode", () => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, "z", 1, "hello");

    expect(result).toEqual({ consumed: true });
    rendered.unmount();
  });

  it("reports a pending operator via hasPendingCommand until the command completes", () => {
    const rendered = renderVimHandler("NORMAL");
    const multi = "one\ntwo\nthree";

    expect(rendered.handler.hasPendingCommand()).toBe(false);
    pressKeys(rendered, "d", 1, multi);
    expect(rendered.handler.hasPendingCommand()).toBe(true);
    pressKeys(rendered, "j", 1, multi);
    expect(rendered.handler.hasPendingCommand()).toBe(false);
    rendered.unmount();
  });

  it("reports a pending g-prefixed command via hasPendingCommand", () => {
    const rendered = renderVimHandler("NORMAL");

    pressKeys(rendered, "g", 1, "hello");
    expect(rendered.handler.hasPendingCommand()).toBe(true);
    pressKeys(rendered, "g", 1, "hello");
    expect(rendered.handler.hasPendingCommand()).toBe(false);
    rendered.unmount();
  });
});

describe("useVimKeyHandler visual-line commands", () => {
  const text = "before  targetafter";
  const range = { start: 6, end: 14 };
  const visualPosition = { row: 1, column: 4 };

  it.each([
    ["0", 6],
    ["^", 8],
    ["$", 13],
  ])("moves %s within the current visual line", (command, expectedPosition) => {
    const rendered = renderVimHandler("NORMAL");

    const result = rendered.handler.handle(
      command,
      normalKey(command),
      10,
      text.length,
      text,
      visualPosition,
      range,
    );

    expect(result).toEqual({ consumed: true, newCursorPosition: expectedPosition });
    rendered.unmount();
  });

  it("keeps h and l inside the current visual line", () => {
    const rendered = renderVimHandler("NORMAL");

    const left = rendered.handler.handle(
      "h",
      normalKey("h"),
      range.start,
      text.length,
      text,
      { row: 1, column: 0 },
      range,
    );
    const right = rendered.handler.handle(
      "l",
      normalKey("l"),
      range.end - 1,
      text.length,
      text,
      { row: 1, column: 7 },
      range,
    );

    expect(left).toEqual({ consumed: true, newCursorPosition: range.start });
    expect(right).toEqual({ consumed: true, newCursorPosition: range.end - 1 });
    rendered.unmount();
  });

  it.each([
    ["I", 8],
    ["A", 14],
  ])("enters Insert mode with %s at the visual-line boundary", (command, expectedPosition) => {
    const rendered = renderVimHandler("NORMAL");

    const result = rendered.handler.handle(
      command,
      normalKey(command),
      10,
      text.length,
      text,
      visualPosition,
      range,
    );

    expect(result).toEqual({ consumed: true, newCursorPosition: expectedPosition });
    expect(rendered.setMode).toHaveBeenCalledWith("INSERT");
    rendered.unmount();
  });

  it.each(["D", "d$"])("applies %s through the visual-line end", command => {
    const rendered = renderVimHandler("NORMAL");
    if (command === "d$") {
      rendered.handler.handle("d", normalKey("d"), 10, text.length, text, visualPosition, range);
    }

    const finalCommand = command === "d$" ? "$" : command;
    const result = rendered.handler.handle(
      finalCommand,
      normalKey(finalCommand),
      10,
      text.length,
      text,
      visualPosition,
      range,
    );

    expect(result).toEqual({
      consumed: true,
      newValue: "before  taafter",
      newCursorPosition: 10,
    });
    rendered.unmount();
  });

  it("applies dd to only the current soft-wrapped visual line", () => {
    const rendered = renderVimHandler("NORMAL");
    rendered.handler.handle("d", normalKey("d"), 10, text.length, text, visualPosition, range);

    const result = rendered.handler.handle(
      "d",
      normalKey("d"),
      10,
      text.length,
      text,
      visualPosition,
      range,
    );

    expect(result).toEqual({ consumed: true, newValue: "beforeafter", newCursorPosition: 6 });
    rendered.unmount();
  });

  it("applies cc to only the current soft-wrapped visual line", () => {
    const rendered = renderVimHandler("NORMAL");
    rendered.handler.handle("c", normalKey("c"), 10, text.length, text, visualPosition, range);

    const result = rendered.handler.handle(
      "c",
      normalKey("c"),
      10,
      text.length,
      text,
      visualPosition,
      range,
    );

    expect(result).toEqual({ consumed: true, newValue: "beforeafter", newCursorPosition: 6 });
    expect(rendered.setMode).toHaveBeenCalledWith("INSERT");
    rendered.unmount();
  });

  it("opens a new line below a soft-wrapped visual line", () => {
    const rendered = renderVimHandler("NORMAL");

    const result = rendered.handler.handle(
      "o",
      normalKey("o"),
      10,
      text.length,
      text,
      visualPosition,
      range,
    );

    expect(result).toEqual({
      consumed: true,
      newValue: "before  target\n\nafter",
      newCursorPosition: 15,
    });
    expect(rendered.setMode).toHaveBeenCalledWith("INSERT");
    rendered.unmount();
  });

  it("opens a new line above a soft-wrapped visual line", () => {
    const rendered = renderVimHandler("NORMAL");

    const result = rendered.handler.handle(
      "O",
      normalKey("O"),
      10,
      text.length,
      text,
      visualPosition,
      range,
    );

    expect(result).toEqual({
      consumed: true,
      newValue: "before\n\n  targetafter",
      newCursorPosition: 7,
    });
    expect(rendered.setMode).toHaveBeenCalledWith("INSERT");
    rendered.unmount();
  });

  it("uses an existing explicit newline when opening below", () => {
    const rendered = renderVimHandler("NORMAL");
    const explicitText = "before\ncurrent\nafter";

    const result = rendered.handler.handle(
      "o",
      normalKey("o"),
      10,
      explicitText.length,
      explicitText,
      { row: 1, column: 3 },
      { start: 7, end: 14 },
    );

    expect(result).toEqual({
      consumed: true,
      newValue: "before\ncurrent\n\nafter",
      newCursorPosition: 15,
    });
    rendered.unmount();
  });
});

describe("useVimKeyHandler g and G commands", () => {
  const text = "one\ntwo\nthree";

  it("jumps to the first non-whitespace character of the last line with G", () => {
    const rendered = renderVimHandler("NORMAL");
    const spacedText = "one\n  three";

    const result = rendered.handler.handle(
      "G",
      normalKey("G"),
      0,
      spacedText.length,
      spacedText,
      null,
      null,
    );

    expect(result).toEqual({ consumed: true, newCursorPosition: 6 });
    rendered.unmount();
  });

  it("jumps to the first non-whitespace character of the first line with gg", () => {
    const rendered = renderVimHandler("NORMAL");
    const spacedText = "  one\ntwo";

    rendered.handler.handle("g", normalKey("g"), 8, spacedText.length, spacedText, null, null);
    const result = rendered.handler.handle(
      "g",
      normalKey("g"),
      8,
      spacedText.length,
      spacedText,
      null,
      null,
    );

    expect(result).toEqual({ consumed: true, newCursorPosition: 2 });
    rendered.unmount();
  });

  it("swallows unknown g-prefixed commands", () => {
    const rendered = renderVimHandler("NORMAL");

    rendered.handler.handle("g", normalKey("g"), 4, text.length, text, null, null);
    const result = rendered.handler.handle("x", normalKey("x"), 4, text.length, text, null, null);

    expect(result).toEqual({ consumed: true });
    rendered.unmount();
  });

  it("deletes from the current line through the end of the buffer with dG", () => {
    const rendered = renderVimHandler("NORMAL");

    rendered.handler.handle("d", normalKey("d"), 4, text.length, text, null, null);
    const result = rendered.handler.handle("G", normalKey("G"), 4, text.length, text, null, null);

    expect(result).toEqual({
      consumed: true,
      newValue: "one",
      newCursorPosition: 0,
    });
    rendered.unmount();
  });

  it("deletes only the last line with dG on the last line", () => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, "dG", 4, "one\ntwo");

    expect(result).toEqual({ consumed: true, newValue: "one", newCursorPosition: 0 });
    rendered.unmount();
  });

  it("deletes only the first line with dgg on the first line", () => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, "dgg", 1, "one\ntwo");

    expect(result).toEqual({ consumed: true, newValue: "two", newCursorPosition: 0 });
    rendered.unmount();
  });

  it("jumps over leading whitespace of an indented first line with gg", () => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, "gg", 8, "  hello\nworld");

    expect(result).toEqual({ consumed: true, newCursorPosition: 2 });
    rendered.unmount();
  });

  it("stays at position 0 with gg when the first line is empty", () => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, "gg", 2, "\nfoo");

    expect(result).toEqual({ consumed: true, newCursorPosition: 0 });
    rendered.unmount();
  });

  it("jumps to the start of the only line with G on a single line", () => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, "G", 3, "hello");

    expect(result).toEqual({ consumed: true, newCursorPosition: 0 });
    rendered.unmount();
  });

  it("jumps to the start of an empty last line with G", () => {
    const rendered = renderVimHandler("NORMAL");
    const trailingEmpty = "a\nb\n\n";

    const result = rendered.handler.handle(
      "G",
      normalKey("G"),
      0,
      trailingEmpty.length,
      trailingEmpty,
      null,
      null,
    );

    expect(result).toEqual({ consumed: true, newCursorPosition: 5 });
    rendered.unmount();
  });

  it("jumps to the start of a whitespace-only last line with G", () => {
    const rendered = renderVimHandler("NORMAL");
    const whitespaceLast = "a\n  ";

    const result = rendered.handler.handle(
      "G",
      normalKey("G"),
      0,
      whitespaceLast.length,
      whitespaceLast,
      null,
      null,
    );

    expect(result).toEqual({ consumed: true, newCursorPosition: 2 });
    rendered.unmount();
  });

  it.each([
    ["one\n\n\n", 0, "", 0],
    ["a\nb\n\n", 2, "a", 0],
    ["a\n\nb", 2, "a", 0],
  ])("dG deletes trailing empty lines in %j", (trailingEmptyText, from, newValue, to) => {
    const rendered = renderVimHandler("NORMAL");

    const result = pressKeys(rendered, "dG", from, trailingEmptyText);

    expect(result).toEqual({ consumed: true, newValue, newCursorPosition: to });
    rendered.unmount();
  });

  it("deletes from the first line through the current line with dgg", () => {
    const rendered = renderVimHandler("NORMAL");

    rendered.handler.handle("d", normalKey("d"), 4, text.length, text, null, null);
    rendered.handler.handle("g", normalKey("g"), 4, text.length, text, null, null);
    const result = rendered.handler.handle("g", normalKey("g"), 4, text.length, text, null, null);

    expect(result).toEqual({
      consumed: true,
      newValue: "three",
      newCursorPosition: 0,
    });
    rendered.unmount();
  });

  it("changes from the first line through the current line with cgg", () => {
    const rendered = renderVimHandler("NORMAL");

    rendered.handler.handle("c", normalKey("c"), 4, text.length, text, null, null);
    rendered.handler.handle("g", normalKey("g"), 4, text.length, text, null, null);
    const result = rendered.handler.handle("g", normalKey("g"), 4, text.length, text, null, null);

    expect(result).toEqual({
      consumed: true,
      newValue: "\nthree",
      newCursorPosition: 0,
    });
    expect(rendered.setMode).toHaveBeenCalledWith("INSERT");
    rendered.unmount();
  });
});
