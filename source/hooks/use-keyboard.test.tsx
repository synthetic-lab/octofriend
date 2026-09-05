import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it, mock } from "bun:test";
import type { PaintKeyboardEvent } from "paintcannon";
import {
  FocusTrap,
  KeyboardProvider,
  useGlobalKeyboard,
  useKeyboard,
  useKeyboardScopeActive,
} from "./use-keyboard.ts";
import { createKeyEvent, press } from "../test-utils/keyboard-events.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function ScopedListener({
  onKey,
  isActive = true,
}: {
  onKey: (event: PaintKeyboardEvent) => void;
  isActive?: boolean;
}) {
  useKeyboard(onKey, isActive);
  return null;
}

function GlobalListener({ onKey }: { onKey: (event: PaintKeyboardEvent) => void }) {
  useGlobalKeyboard(onKey);
  return null;
}

function ScopeActiveProbe({ report }: { report: (active: boolean) => void }) {
  const active = useKeyboardScopeActive();
  React.useEffect(() => {
    report(active);
  }, [active, report]);
  return null;
}

describe("keyboard scope router", () => {
  it("routes keys to base scope listeners", () => {
    const onKey = mock();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <KeyboardProvider>
          <ScopedListener onKey={onKey} />
        </KeyboardProvider>,
      );
    });

    const event = createKeyEvent({ key: "x" });
    press(renderer!, event);

    expect(onKey).toHaveBeenCalledTimes(1);
    expect(onKey).toHaveBeenCalledWith(event);
    act(() => renderer!.unmount());
  });

  it("does not route to inactive scoped listeners", () => {
    const onKey = mock();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <KeyboardProvider>
          <ScopedListener onKey={onKey} isActive={false} />
        </KeyboardProvider>,
      );
    });

    press(renderer!, createKeyEvent({ key: "x" }));

    expect(onKey).not.toHaveBeenCalled();
    act(() => renderer!.unmount());
  });

  it("silences base scope handlers while a FocusTrap is active", () => {
    const baseKey = mock();
    const trapKey = mock();
    let renderer: TestRenderer.ReactTestRenderer;
    const renderTree = (trapOpen: boolean) => (
      <KeyboardProvider>
        <ScopedListener onKey={baseKey} />
        {trapOpen && (
          <FocusTrap>
            <ScopedListener onKey={trapKey} />
          </FocusTrap>
        )}
      </KeyboardProvider>
    );
    act(() => {
      renderer = TestRenderer.create(renderTree(true));
    });

    press(renderer!, createKeyEvent({ key: "j" }));

    expect(baseKey).not.toHaveBeenCalled();
    expect(trapKey).toHaveBeenCalledTimes(1);
    act(() => renderer!.unmount());
  });

  it("routes only to the innermost trap when traps nest", () => {
    const baseKey = mock();
    const outerKey = mock();
    const innerKey = mock();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <KeyboardProvider>
          <ScopedListener onKey={baseKey} />
          <FocusTrap>
            <ScopedListener onKey={outerKey} />
            <FocusTrap>
              <ScopedListener onKey={innerKey} />
            </FocusTrap>
          </FocusTrap>
        </KeyboardProvider>,
      );
    });

    press(renderer!, createKeyEvent({ key: "k" }));

    expect(baseKey).not.toHaveBeenCalled();
    expect(outerKey).not.toHaveBeenCalled();
    expect(innerKey).toHaveBeenCalledTimes(1);
    act(() => renderer!.unmount());
  });

  it("restores the parent scope when the innermost trap closes", () => {
    const baseKey = mock();
    const outerKey = mock();
    const innerKey = mock();
    let renderer: TestRenderer.ReactTestRenderer;
    const renderTree = (innerOpen: boolean) => (
      <KeyboardProvider>
        <ScopedListener onKey={baseKey} />
        <FocusTrap>
          <ScopedListener onKey={outerKey} />
          {innerOpen && (
            <FocusTrap>
              <ScopedListener onKey={innerKey} />
            </FocusTrap>
          )}
        </FocusTrap>
      </KeyboardProvider>
    );
    act(() => {
      renderer = TestRenderer.create(renderTree(true));
    });
    act(() => {
      renderer!.update(renderTree(false));
    });

    press(renderer!, createKeyEvent({ key: "k" }));

    expect(baseKey).not.toHaveBeenCalled();
    expect(outerKey).toHaveBeenCalledTimes(1);
    expect(innerKey).not.toHaveBeenCalled();
    act(() => renderer!.unmount());
  });

  it("restores the base scope when the trap closes", () => {
    const baseKey = mock();
    const trapKey = mock();
    let renderer: TestRenderer.ReactTestRenderer;
    const renderTree = (trapOpen: boolean) => (
      <KeyboardProvider>
        <ScopedListener onKey={baseKey} />
        {trapOpen && (
          <FocusTrap>
            <ScopedListener onKey={trapKey} />
          </FocusTrap>
        )}
      </KeyboardProvider>
    );
    act(() => {
      renderer = TestRenderer.create(renderTree(true));
    });
    act(() => {
      renderer!.update(renderTree(false));
    });

    press(renderer!, createKeyEvent({ key: "j" }));

    expect(baseKey).toHaveBeenCalledTimes(1);
    expect(trapKey).not.toHaveBeenCalled();
    act(() => renderer!.unmount());
  });

  it("runs active scope handlers before global handlers", () => {
    const order: string[] = [];
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <KeyboardProvider>
          <ScopedListener
            onKey={() => {
              order.push("scoped");
            }}
          />
          <GlobalListener
            onKey={() => {
              order.push("global");
            }}
          />
        </KeyboardProvider>,
      );
    });

    press(renderer!, createKeyEvent({ key: "x" }));

    expect(order).toEqual(["scoped", "global"]);
    act(() => renderer!.unmount());
  });

  it("lets global handlers see defaultPrevented set by active scope handlers", () => {
    const observed: { prevented: boolean | null } = { prevented: null };
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <KeyboardProvider>
          <ScopedListener
            onKey={event => {
              if (event.key === "c" && event.ctrlKey) event.preventDefault();
            }}
          />
          <GlobalListener
            onKey={event => {
              observed.prevented = event.defaultPrevented;
            }}
          />
        </KeyboardProvider>,
      );
    });

    press(renderer!, createKeyEvent({ key: "c", ctrlKey: true }));

    expect(observed.prevented).toBe(true);
    act(() => renderer!.unmount());
  });

  it("prevents Tab traversal from escaping an active trap to background controls", () => {
    const baseKey = mock();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <KeyboardProvider>
          <ScopedListener onKey={baseKey} />
          <FocusTrap>
            <ScopedListener onKey={() => {}} />
          </FocusTrap>
        </KeyboardProvider>,
      );
    });

    const tabEvent = createKeyEvent({ key: "Tab" });
    press(renderer!, tabEvent);
    expect(tabEvent.defaultPrevented).toBe(true);
    expect(baseKey).not.toHaveBeenCalled();

    const shiftTabEvent = createKeyEvent({ key: "Tab", shiftKey: true });
    press(renderer!, shiftTabEvent);
    expect(shiftTabEvent.defaultPrevented).toBe(true);
    act(() => renderer!.unmount());
  });

  it("reports scope activity for the base scope and traps", () => {
    const baseActivity: boolean[] = [];
    const trapActivity: boolean[] = [];
    const reportBase = (active: boolean) => baseActivity.push(active);
    const reportTrap = (active: boolean) => trapActivity.push(active);
    let renderer: TestRenderer.ReactTestRenderer;
    const renderTree = (trapOpen: boolean) => (
      <KeyboardProvider>
        <ScopeActiveProbe report={reportBase} />
        {trapOpen && (
          <FocusTrap>
            <ScopeActiveProbe report={reportTrap} />
          </FocusTrap>
        )}
      </KeyboardProvider>
    );
    act(() => {
      renderer = TestRenderer.create(renderTree(false));
    });
    expect(baseActivity).toEqual([true]);

    act(() => {
      renderer!.update(renderTree(true));
    });
    expect(baseActivity).toEqual([true, false]);
    expect(trapActivity).toEqual([false, true]);

    act(() => {
      renderer!.update(renderTree(false));
    });
    expect(baseActivity).toEqual([true, false, true]);
    act(() => renderer!.unmount());
  });
});
