import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { mock as registryMock } from "antipattern";
import type { PaintKeyboardEvent } from "paintcannon";
import { keyboardDeps } from "../hooks/use-keyboard.ts";
import { useCtrlC } from "./exit-on-double-ctrl-c.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let keyboardHandler: ((event: PaintKeyboardEvent) => void) | null = null;
const restoreKeyboard = registryMock(
  keyboardDeps,
  "useKeyboard",
  (handler: (event: PaintKeyboardEvent) => void) => {
    keyboardHandler = handler;
  },
);

function Harness({ onCtrlC }: { onCtrlC: () => void }) {
  useCtrlC(onCtrlC);
  return null;
}

describe("useCtrlC", () => {
  beforeEach(() => {
    keyboardHandler = null;
  });

  afterAll(() => {
    restoreKeyboard();
  });

  it("ignores Ctrl-C when a focused control already handled it", () => {
    const onCtrlC = mock();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Harness onCtrlC={onCtrlC} />);
    });

    act(() => {
      keyboardHandler?.({
        ctrlKey: true,
        key: "c",
        defaultPrevented: true,
      } as PaintKeyboardEvent);
    });

    expect(onCtrlC).not.toHaveBeenCalled();
    act(() => renderer!.unmount());
  });

  it("handles an unconsumed Ctrl-C", () => {
    const onCtrlC = mock();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Harness onCtrlC={onCtrlC} />);
    });

    act(() => {
      keyboardHandler?.({
        ctrlKey: true,
        key: "c",
        defaultPrevented: false,
      } as PaintKeyboardEvent);
    });

    expect(onCtrlC).toHaveBeenCalledTimes(1);
    act(() => renderer!.unmount());
  });
});
