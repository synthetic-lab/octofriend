import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { withMock } from "antipattern";
import type { PaintKeyboardEvent } from "paintcannon";
import { describe, expect, it, vi } from "vitest";
import { keyboardDeps } from "../../hooks/use-keyboard.ts";
import { KbShortcutSelect } from "./kb-shortcut-select.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("KbShortcutSelect", () => {
  it("prevents the default Enter action when selecting an item", async () => {
    let keyboardHandler: ((event: PaintKeyboardEvent) => void) | undefined;
    const useKeyboard = vi.fn((callback: (event: PaintKeyboardEvent) => void) => {
      keyboardHandler = callback;
    });
    const onSelect = vi.fn();
    const preventDefault = vi.fn();

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

      expect(preventDefault).toHaveBeenCalledOnce();
      expect(onSelect).toHaveBeenCalledWith({
        label: "Enter an API key",
        value: "api-key",
      });
      act(() => renderer!.unmount());
    });
  });
});
