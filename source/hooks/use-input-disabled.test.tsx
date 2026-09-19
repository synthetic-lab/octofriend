import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it, mock } from "bun:test";
import { Div } from "paintcannon-react";
import { PaintKeyboardEvent } from "paintcannon";
import { KeyboardProvider, useKeyboard } from "./use-keyboard.ts";
import { InputDisabledProvider, useInputDisabled } from "./use-input-disabled.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function Listener({ onKey }: { onKey: (event: PaintKeyboardEvent) => void }) {
  useKeyboard(onKey);
  return <span>{String(useInputDisabled())}</span>;
}

describe("menu input isolation", () => {
  it("disables existing and newly mounted background handlers until the menu closes", () => {
    const background = mock();
    const lateBackground = mock();
    const menu = mock();
    function Harness({ isMenuOpen, responding }: { isMenuOpen: boolean; responding: boolean }) {
      return (
        <KeyboardProvider>
          <InputDisabledProvider disabled={isMenuOpen}>
            <Listener onKey={background} />
            {responding && <Listener onKey={lateBackground} />}
          </InputDisabledProvider>
          {isMenuOpen && <Listener onKey={menu} />}
        </KeyboardProvider>
      );
    }
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Harness isMenuOpen={false} responding={false} />);
    });
    const keys = ["m", "a", "j", "ArrowUp", "Enter", "Escape", "Tab", "c", "p"];
    function pressKeys() {
      for (const key of keys) {
        const event = new PaintKeyboardEvent({
          type: "keydown",
          key,
          code: key,
          ctrlKey: key === "c" || key === "p",
          altKey: false,
          metaKey: false,
          shiftKey: key === "Tab",
          repeat: false,
        });
        act(() => renderer.root.findByType(Div).props["onKeyDown"](event));
      }
    }
    pressKeys();
    expect(background).toHaveBeenCalledTimes(keys.length);
    background.mockClear();

    act(() => renderer.update(<Harness isMenuOpen={true} responding={true} />));
    expect(renderer!.root.findAllByType("span").map(node => node.children)).toEqual([
      ["true"],
      ["true"],
      ["false"],
    ]);
    pressKeys();
    expect(background).not.toHaveBeenCalled();
    expect(lateBackground).not.toHaveBeenCalled();
    expect(menu).toHaveBeenCalledTimes(keys.length);

    act(() => renderer.update(<Harness isMenuOpen={false} responding={true} />));
    pressKeys();
    expect(background).toHaveBeenCalledTimes(keys.length);
    expect(lateBackground).toHaveBeenCalledTimes(keys.length);
    expect(menu).toHaveBeenCalledTimes(keys.length);
    act(() => renderer.unmount());
  });
});
