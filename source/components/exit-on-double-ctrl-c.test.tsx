import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaintKeyboardEvent } from "paintcannon";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const keyboard = vi.hoisted(() => ({
  handler: null as ((event: PaintKeyboardEvent) => void) | null,
}));

vi.mock("../hooks/use-keyboard.ts", () => ({
  useKeyboard(handler: (event: PaintKeyboardEvent) => void) {
    keyboard.handler = handler;
  },
}));

import { useCtrlC } from "./exit-on-double-ctrl-c.tsx";

function Harness({ onCtrlC }: { onCtrlC: () => void }) {
  useCtrlC(onCtrlC);
  return null;
}

describe("useCtrlC", () => {
  beforeEach(() => {
    keyboard.handler = null;
  });

  it("ignores Ctrl-C when a focused control already handled it", () => {
    const onCtrlC = vi.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Harness onCtrlC={onCtrlC} />);
    });

    act(() => {
      keyboard.handler?.({
        ctrlKey: true,
        key: "c",
        defaultPrevented: true,
      } as PaintKeyboardEvent);
    });

    expect(onCtrlC).not.toHaveBeenCalled();
    act(() => renderer!.unmount());
  });

  it("handles an unconsumed Ctrl-C", () => {
    const onCtrlC = vi.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Harness onCtrlC={onCtrlC} />);
    });

    act(() => {
      keyboard.handler?.({
        ctrlKey: true,
        key: "c",
        defaultPrevented: false,
      } as PaintKeyboardEvent);
    });

    expect(onCtrlC).toHaveBeenCalledOnce();
    act(() => renderer!.unmount());
  });
});
