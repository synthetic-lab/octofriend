import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { PaintKeyboardEvent } from "paintcannon";
import { useVimKeyHandler } from "./vim-mode.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type VimHandler = ReturnType<typeof useVimKeyHandler>;

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

const ctrlC = {
  key: "c",
  ctrlKey: true,
} as PaintKeyboardEvent;

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

const normalKey = (key: string) =>
  ({
    key,
    ctrlKey: false,
  }) as PaintKeyboardEvent;

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
