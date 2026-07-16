import React from "react";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

export type PaintcannonRender = {
  text: string;
  hasStyles: boolean;
};

export function renderPaintcannon(element: React.ReactElement): PaintcannonRender {
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    renderer = TestRenderer.create(element);
  });

  const root = renderer!.root;
  const text = collectText(root);
  const hasStyles =
    root.findAll(node => {
      const style = node.props["style"] as Record<string, unknown> | undefined;
      return style !== undefined && Object.keys(style).length > 0;
    }).length > 0;
  act(() => renderer!.unmount());
  return { text, hasStyles };
}

function collectText(node: ReactTestInstance): string {
  return node.children
    .map(child => (typeof child === "string" ? child : collectText(child)))
    .join("");
}
