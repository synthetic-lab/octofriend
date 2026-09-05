import TestRenderer, { act } from "react-test-renderer";
import type { PaintKeyboardEvent } from "paintcannon";

export function createKeyEvent(
  props: Partial<PaintKeyboardEvent> & { key: string },
): PaintKeyboardEvent {
  const event = {
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
    stopPropagation() {
      event.propagationStopped = true;
    },
    ...props,
  };
  return event as unknown as PaintKeyboardEvent;
}

export function hostNodesOfType(renderer: TestRenderer.ReactTestRenderer, type: string) {
  return renderer.root.findAll(instance => (instance.type as unknown) === type);
}

export function hostProp<T = unknown>(
  node: TestRenderer.ReactTestInstance,
  prop: string,
): T | undefined {
  return node.props[prop] as T | undefined;
}

export function press(renderer: TestRenderer.ReactTestRenderer, event: PaintKeyboardEvent) {
  const rootDiv = hostNodesOfType(renderer, "paintcannon.div")[0];
  act(() => {
    hostProp<(event: PaintKeyboardEvent) => void>(rootDiv, "onKeyDown")?.(event);
  });
}

export function collectText(root: TestRenderer.ReactTestInstance): string {
  return root.children
    .map(child => (typeof child === "string" ? child : collectText(child)))
    .join("");
}
