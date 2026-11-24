import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { withMock } from "antipattern";
import type { PaintKeyboardEvent } from "paintcannon";
import { Span } from "paintcannon-react";
import { describe, expect, it, mock } from "bun:test";
import { keyboardDeps } from "../../hooks/use-keyboard.ts";
import { KbShortcutSelect, type ShortcutArray } from "./kb-shortcut-select.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("KbShortcutSelect", () => {
  const order = Array.from({ length: 13 }, (_, value) => ({ label: `Template ${value}`, value }));
  const paginationCases: Array<{
    name: string;
    shortcutItems: ShortcutArray<number>;
    nextLabel: string;
    previousLabel: string;
  }> = [
    {
      name: "a single populated section",
      shortcutItems: [
        {
          type: "sections",
          sections: [
            { id: "empty", title: "Empty", order: [] },
            { id: "web", title: "Web Templates", order },
          ],
        },
      ],
      nextLabel: "More Web Templates",
      previousLabel: "Previous Web Templates",
    },
    {
      name: "an untitled list",
      shortcutItems: [{ type: "auto-list", order }],
      nextLabel: "Next page",
      previousLabel: "Previous page",
    },
    {
      name: "pagination shared across sections",
      shortcutItems: [
        {
          type: "sections",
          sections: [
            { id: "web", title: "Web Templates", order: order.slice(0, 5) },
            { id: "cli", title: "CLI Templates", order: order.slice(5) },
          ],
        },
      ],
      nextLabel: "Next page",
      previousLabel: "Previous page",
    },
  ];

  it.each(paginationCases)(
    "labels and navigates $name",
    async ({ shortcutItems, nextLabel, previousLabel }) => {
      let keyboardHandler: (event: PaintKeyboardEvent) => void;
      const onSelect = mock();
      await withMock(
        keyboardDeps,
        "useKeyboard",
        callback => {
          keyboardHandler = callback;
        },
        async () => {
          let renderer: TestRenderer.ReactTestRenderer;
          act(() => {
            renderer = TestRenderer.create(
              <KbShortcutSelect shortcutItems={shortcutItems} onSelect={onSelect} />,
            );
          });
          const labels = () => renderer.root.findAllByType(Span).flatMap(span => span.children);
          expect(labels()).toContain(nextLabel);
          expect(labels()).not.toContain(previousLabel);
          act(() => {
            keyboardHandler({ key: "l", preventDefault: mock() } as unknown as PaintKeyboardEvent);
          });
          expect(labels()).toContain(previousLabel);
          expect(labels()).not.toContain(nextLabel);
          expect(labels()).toContain("Template 10");
          act(() => {
            keyboardHandler({ key: "0", preventDefault: mock() } as unknown as PaintKeyboardEvent);
          });
          expect(onSelect).toHaveBeenCalledWith(order[10]);
          act(() => {
            keyboardHandler({ key: "h", preventDefault: mock() } as unknown as PaintKeyboardEvent);
          });
          expect(labels()).toContain("Template 0");
          expect(labels()).toContain(nextLabel);
          act(() => renderer.unmount());
        },
      );
    },
  );

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
});
