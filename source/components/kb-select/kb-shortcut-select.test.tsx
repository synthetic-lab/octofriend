import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { withMock } from "antipattern";
import type { PaintKeyboardEvent } from "paintcannon";
import { describe, expect, it, mock } from "bun:test";
import { keyboardDeps } from "../../hooks/use-keyboard.ts";
import { KbShortcutSelect } from "./kb-shortcut-select.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("KbShortcutSelect", () => {
  it("prevents the default Enter action when selecting an item", async () => {
    let keyboardHandler: ((event: PaintKeyboardEvent) => void) | undefined;
    const useKeyboard = mock((callback: (event: PaintKeyboardEvent) => void) => {
      keyboardHandler = callback;
    });
    const onSelect = mock();
    const preventDefault = mock();

    await withMock(keyboardDeps, "useKeyboard", useKeyboard, async () => {
      let renderer: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(
          <KbShortcutSelect
            shortcutItems={[
              {
                type: "key",
                mapping: {
                  a: { label: "Enter an API key", value: "api-key" },
                  e: { label: "Use an environment variable", value: "env-var" },
                },
              },
            ]}
            onSelect={onSelect}
          />,
        );
      });

      act(() => {
        keyboardHandler?.({
          key: "Enter",
          preventDefault,
        } as unknown as PaintKeyboardEvent);
      });

      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith({
        label: "Enter an API key",
        value: "api-key",
      });
      act(() => renderer!.unmount());
    });
  });

  it("prevents the default action when a letter shortcut is handled", async () => {
    let keyboardHandler: ((event: PaintKeyboardEvent) => void) | undefined;
    const useKeyboard = mock((callback: (event: PaintKeyboardEvent) => void) => {
      keyboardHandler = callback;
    });
    const onSelect = mock();
    const preventDefault = mock();

    await withMock(keyboardDeps, "useKeyboard", useKeyboard, async () => {
      let renderer: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(
          <KbShortcutSelect
            shortcutItems={[
              {
                type: "key",
                mapping: {
                  a: { label: "Enter an API key", value: "api-key" },
                  e: { label: "Use an environment variable", value: "env-var" },
                },
              },
            ]}
            onSelect={onSelect}
          />,
        );
      });

      act(() => {
        keyboardHandler?.({
          key: "e",
          preventDefault,
        } as unknown as PaintKeyboardEvent);
      });

      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith({
        label: "Use an environment variable",
        value: "env-var",
      });
      act(() => renderer!.unmount());
    });
  });

  it.each([["j"], ["k"], ["ArrowDown"], ["ArrowUp"]])(
    "prevents the default action when %s moves the selection",
    async key => {
      let keyboardHandler: ((event: PaintKeyboardEvent) => void) | undefined;
      const useKeyboard = mock((callback: (event: PaintKeyboardEvent) => void) => {
        keyboardHandler = callback;
      });
      const onSelect = mock();
      const preventDefault = mock();

      await withMock(keyboardDeps, "useKeyboard", useKeyboard, async () => {
        let renderer: TestRenderer.ReactTestRenderer;
        act(() => {
          renderer = TestRenderer.create(
            <KbShortcutSelect
              shortcutItems={[
                {
                  type: "key",
                  mapping: {
                    a: { label: "Enter an API key", value: "api-key" },
                    e: { label: "Use an environment variable", value: "env-var" },
                  },
                },
              ]}
              onSelect={onSelect}
            />,
          );
        });

        act(() => {
          keyboardHandler?.({
            key,
            preventDefault,
          } as unknown as PaintKeyboardEvent);
        });

        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(onSelect).not.toHaveBeenCalled();
        act(() => renderer!.unmount());
      });
    },
  );
});
