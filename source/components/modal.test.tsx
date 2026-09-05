import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it, mock } from "bun:test";
import type { PaintKeyboardEvent } from "paintcannon";
import { Span } from "paintcannon-react";
import { AnimationContext } from "paintcannon-react/dist/src/hooks/use-animation.js";
import { AppContext } from "paintcannon-react/dist/src/hooks/use-app.js";
import { KeyboardProvider, useKeyboard } from "../hooks/use-keyboard.ts";
import { createKeyEvent, hostProp, press } from "../test-utils/keyboard-events.tsx";
import { Modal } from "./modal.tsx";
import TextInput from "./text-input.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const APP = { paintCannon: { requestAnimationFrame: () => 0 } };

function afterEntranceDelayAnimation(timeMs: number) {
  let fired = false;
  return {
    subscribe(callback: (time: number) => void) {
      if (!fired) {
        fired = true;
        callback(timeMs);
      }
      return { startTime: 0, unsubscribe() {} };
    },
  };
}

const stillAnimating = () => afterEntranceDelayAnimation(0);

type BoxStyle = { visibility?: string; position?: string };

function VisibilityBox({ renderer }: { renderer: TestRenderer.ReactTestRenderer }) {
  return renderer.root.find(node => {
    if ((node.type as unknown) !== "paintcannon.div") return false;
    const style = hostProp<BoxStyle>(node, "style");
    return (
      style?.position === "relative" &&
      (style?.visibility === "hidden" || style?.visibility === "visible")
    );
  });
}

describe("Modal", () => {
  it("mounts children immediately even while the visible box is delayed", () => {
    const childKey = mock();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <AnimationContext.Provider value={stillAnimating()}>
          <KeyboardProvider>
            <Modal>
              <ModalBody onKey={childKey} />
            </Modal>
          </KeyboardProvider>
        </AnimationContext.Provider>,
      );
    });

    expect(renderer!.root.findAllByType(Span).length).toBeGreaterThan(0);
    const box = VisibilityBox({ renderer: renderer! });
    expect(hostProp<BoxStyle>(box, "style")?.visibility).toBe("hidden");

    press(renderer!, createKeyEvent({ key: "m" }));
    expect(childKey).toHaveBeenCalledTimes(1);
    act(() => renderer!.unmount());
  });

  it("shows the box after the entrance delay", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <AnimationContext.Provider value={afterEntranceDelayAnimation(1000)}>
          <KeyboardProvider>
            <Modal>
              <ModalBody onKey={() => {}} />
            </Modal>
          </KeyboardProvider>
        </AnimationContext.Provider>,
      );
    });

    const box = VisibilityBox({ renderer: renderer! });
    expect(hostProp<BoxStyle>(box, "style")?.visibility).toBe("visible");
    act(() => renderer!.unmount());
  });

  it("blurs the background chat textarea while active and refocuses it on close", () => {
    const textareaNode = {
      focus: mock(),
      blur: mock(),
      cursorPosition: 0,
    };
    const renderTree = (modalOpen: boolean) => (
      <AnimationContext.Provider value={stillAnimating()}>
        <AppContext.Provider value={APP as never}>
          <KeyboardProvider>
            <TextInput value="draft" onChange={() => {}} />
            {modalOpen && (
              <Modal>
                <ModalBody onKey={() => {}} />
              </Modal>
            )}
          </KeyboardProvider>
        </AppContext.Provider>
      </AnimationContext.Provider>
    );
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(renderTree(false), {
        createNodeMock: element =>
          element.type === "paintcannon.textarea"
            ? textareaNode
            : { clientWidth: 10, clientHeight: 3 },
      });
    });

    expect(textareaNode.focus).toHaveBeenCalledTimes(1);
    expect(textareaNode.blur).not.toHaveBeenCalled();

    act(() => {
      renderer!.update(renderTree(true));
    });
    expect(textareaNode.blur).toHaveBeenCalledTimes(1);
    expect(textareaNode.focus).toHaveBeenCalledTimes(1);

    act(() => {
      renderer!.update(renderTree(false));
    });
    expect(textareaNode.focus).toHaveBeenCalledTimes(2);
    expect(textareaNode.blur).toHaveBeenCalledTimes(1);
    act(() => renderer!.unmount());
  });
});

function ModalBody({ onKey }: { onKey: (event: PaintKeyboardEvent) => void }) {
  useKeyboard(onKey);
  return <Span>menu body</Span>;
}
