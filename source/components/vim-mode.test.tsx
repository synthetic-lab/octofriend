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

    const result = rendered.handler.handle("c", ctrlC, 5, 5, "hello");

    expect(result).toEqual({ consumed: true, newCursorPosition: 4 });
    expect(rendered.setMode).toHaveBeenCalledWith("NORMAL");
    rendered.unmount();
  });

  it("leaves Ctrl-C unconsumed in Normal mode for the app-level exit handler", () => {
    const rendered = renderVimHandler("NORMAL");

    const result = rendered.handler.handle("c", ctrlC, 4, 5, "hello");

    expect(result).toEqual({ consumed: false });
    expect(rendered.setMode).not.toHaveBeenCalled();
    rendered.unmount();
  });
});
