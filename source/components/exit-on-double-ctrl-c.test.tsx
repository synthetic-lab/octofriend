import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it, mock } from "bun:test";
import type { PaintKeyboardEvent } from "paintcannon";
import { AppContext } from "paintcannon-react/dist/src/hooks/use-app.js";
import { FocusTrap, KeyboardProvider, useKeyboard } from "../hooks/use-keyboard.ts";
import { SessionContext } from "../session-context.ts";
import { createSession } from "../session-history/index.ts";
import {
  createKeyEvent,
  hostNodesOfType,
  hostProp,
  press,
} from "../test-utils/keyboard-events.tsx";
import { ExitOnDoubleCtrlC, useCtrlC, useCtrlCPressed } from "./exit-on-double-ctrl-c.tsx";
import TextInput from "./text-input.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ctrlCEvent = () => createKeyEvent({ key: "c", ctrlKey: true });

function PressedProbe({ report }: { report: (pressed: boolean) => void }) {
  const pressed = useCtrlCPressed();
  React.useEffect(() => {
    report(pressed);
  }, [pressed, report]);
  return null;
}

function renderExitHarness(exit: () => void, children?: React.ReactNode) {
  const pressedHistory: boolean[] = [];
  const report = (pressed: boolean) => pressedHistory.push(pressed);
  const session = createSession(process.cwd(), { kind: "local" });
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <AppContext.Provider value={{ exit } as never}>
        <SessionContext.Provider value={session}>
          <KeyboardProvider>
            <ExitOnDoubleCtrlC>
              <PressedProbe report={report} />
              {children}
            </ExitOnDoubleCtrlC>
          </KeyboardProvider>
        </SessionContext.Provider>
      </AppContext.Provider>,
    );
  });
  return {
    get renderer() {
      return renderer!;
    },
    pressedHistory,
    currentPressed: () => pressedHistory[pressedHistory.length - 1],
    unmount() {
      act(() => renderer.unmount());
    },
  };
}

describe("ExitOnDoubleCtrlC", () => {
  it("arms on the first unconsumed Ctrl-C and exits on the second", () => {
    const exit = mock();
    const harness = renderExitHarness(exit);

    press(harness.renderer, ctrlCEvent());
    expect(harness.currentPressed()).toBe(true);
    expect(exit).not.toHaveBeenCalled();

    press(harness.renderer, ctrlCEvent());
    expect(exit).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("does not arm exit when a handler consumed the Ctrl-C", () => {
    const exit = mock();
    const harness = renderExitHarness(exit, <ConsumeCtrlC onConsume={() => {}} />);

    press(harness.renderer, ctrlCEvent());
    expect(harness.currentPressed()).toBe(false);

    press(harness.renderer, ctrlCEvent());
    expect(harness.currentPressed()).toBe(false);
    expect(exit).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("does not arm exit for Vim INSERT mode Ctrl-C consumed by the textarea", () => {
    const exit = mock();
    const setVimMode = mock();
    const session = createSession(process.cwd(), { kind: "local" });
    const textareaNode = {
      cursorPosition: 0,
      focus() {},
      blur() {},
      moveCursorVertically() {
        return null;
      },
      getCursorVisualPosition() {
        return { row: 0, column: 0 };
      },
      getVisualLineRange() {
        return { start: 0, end: 0 };
      },
    };
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <AppContext.Provider
          value={{ exit, paintCannon: { requestAnimationFrame: () => 0 } } as never}
        >
          <SessionContext.Provider value={session}>
            <KeyboardProvider>
              <ExitOnDoubleCtrlC>
                <TextInput
                  value="hello"
                  onChange={() => {}}
                  vimEnabled={true}
                  vimMode="INSERT"
                  setVimMode={setVimMode}
                />
              </ExitOnDoubleCtrlC>
            </KeyboardProvider>
          </SessionContext.Provider>
        </AppContext.Provider>,
        { createNodeMock: () => textareaNode },
      );
    });
    const pressedHistory: boolean[] = [];
    act(() => {
      renderer!.update(
        <AppContext.Provider
          value={{ exit, paintCannon: { requestAnimationFrame: () => 0 } } as never}
        >
          <SessionContext.Provider value={session}>
            <KeyboardProvider>
              <ExitOnDoubleCtrlC>
                <PressedProbe report={pressed => pressedHistory.push(pressed)} />
                <TextInput
                  value="hello"
                  onChange={() => {}}
                  vimEnabled={true}
                  vimMode="INSERT"
                  setVimMode={setVimMode}
                />
              </ExitOnDoubleCtrlC>
            </KeyboardProvider>
          </SessionContext.Provider>
        </AppContext.Provider>,
      );
    });

    const event = ctrlCEvent();
    const textarea = hostNodesOfType(renderer!, "paintcannon.textarea")[0];
    act(() => {
      hostProp<(keyboardEvent: PaintKeyboardEvent) => void>(textarea, "onKeyDown")?.(event);
    });
    if (!event.propagationStopped) press(renderer!, event);

    expect(setVimMode).toHaveBeenCalledWith("NORMAL");
    expect(event.defaultPrevented).toBe(true);
    expect(pressedHistory[pressedHistory.length - 1]).toBe(false);
    expect(exit).not.toHaveBeenCalled();
    act(() => renderer!.unmount());
  });

  it("arms global exit for an unconsumed Ctrl-C while a modal is open", () => {
    const exit = mock();
    const harness = renderExitHarness(
      exit,
      <FocusTrap>
        <ModalContent />
      </FocusTrap>,
    );

    press(harness.renderer, ctrlCEvent());
    expect(harness.currentPressed()).toBe(true);
    expect(exit).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("does not arm global exit when a modal-local Ctrl-C handler consumes the event", () => {
    const exit = mock();
    const harness = renderExitHarness(
      exit,
      <FocusTrap>
        <ConsumeCtrlC onConsume={() => {}} />
      </FocusTrap>,
    );

    press(harness.renderer, ctrlCEvent());
    expect(harness.currentPressed()).toBe(false);
    expect(exit).not.toHaveBeenCalled();
    harness.unmount();
  });
});

function ModalContent() {
  useKeyboard(() => {});
  return null;
}

function ConsumeCtrlC({ onConsume }: { onConsume: () => void }) {
  useKeyboard(event => {
    if (event.ctrlKey && event.key === "c") {
      event.preventDefault();
      onConsume();
    }
  });
  return null;
}

describe("useCtrlC", () => {
  it("ignores Ctrl-C when a focused control already handled it", () => {
    const onCtrlC = mock();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <KeyboardProvider>
          <CtrlCHarness onCtrlC={onCtrlC} />
        </KeyboardProvider>,
      );
    });

    const event = ctrlCEvent();
    event.preventDefault();
    press(renderer!, event);

    expect(onCtrlC).not.toHaveBeenCalled();
    act(() => renderer!.unmount());
  });

  it("handles an unconsumed Ctrl-C", () => {
    const onCtrlC = mock();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <KeyboardProvider>
          <CtrlCHarness onCtrlC={onCtrlC} />
        </KeyboardProvider>,
      );
    });

    press(renderer!, ctrlCEvent());

    expect(onCtrlC).toHaveBeenCalledTimes(1);
    act(() => renderer!.unmount());
  });
});

function CtrlCHarness({ onCtrlC }: { onCtrlC: () => void }) {
  useCtrlC(onCtrlC);
  return null;
}
