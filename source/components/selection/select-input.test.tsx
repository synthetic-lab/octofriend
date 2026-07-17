import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { withMock } from "antipattern";
import type { PaintKeyboardEvent } from "paintcannon";
import { keyboardDeps } from "../../hooks/use-keyboard.ts";
import SelectInput from "./select-input.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("SelectInput", () => {
  it("prevents the default Enter action when selecting an item", async () => {
    let keyboardHandler: ((event: PaintKeyboardEvent) => void) | undefined;
    const useKeyboard = vi.fn(
      (callback: (event: PaintKeyboardEvent) => void, _isActive?: boolean) => {
        keyboardHandler = callback;
      },
    );
    const onSelect = vi.fn();
    const preventDefault = vi.fn();

    await withMock(keyboardDeps, "useKeyboard", useKeyboard, async () => {
      let renderer: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(
          <SelectInput
            items={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            initialIndex={1}
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
      expect(onSelect).toHaveBeenCalledWith({ label: "No", value: "no" });
      act(() => renderer!.unmount());
    });
  });
});
