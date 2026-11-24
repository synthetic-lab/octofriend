import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, describe, expect, it } from "bun:test";
import { Span } from "paintcannon-react";
import { AnimationContext } from "paintcannon-react/dist/src/hooks/use-animation.js";
import Loading from "./loading.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let renderer: TestRenderer.ReactTestRenderer | undefined;
let time = 0;
const subscribers = new Set<(time: number) => void>();
const animation = {
  subscribe(callback: (time: number) => void) {
    subscribers.add(callback);
    return {
      startTime: time,
      unsubscribe() {
        subscribers.delete(callback);
      },
    };
  },
};

function render(overrideStrings?: string[]) {
  act(() => {
    const element = (
      <AnimationContext.Provider value={animation}>
        <Loading overrideStrings={overrideStrings} />
      </AnimationContext.Provider>
    );
    if (renderer == null) {
      renderer = TestRenderer.create(element);
    } else {
      renderer.update(element);
    }
  });
}

function completeSweep() {
  time += 10000;
  act(() => {
    for (const callback of [...subscribers]) callback(time);
  });
}

function text(): string {
  return renderer!.root
    .findAllByType(Span)
    .flatMap(node => node.children.filter(child => typeof child === "string"))
    .join("");
}

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  time = 0;
  subscribers.clear();
});

describe("Loading message changes", () => {
  it.each(["Compacting history to save context tokens", "Auto-fixing diff", "Auto-fixing JSON"])(
    "switches from a later default message to %s",
    message => {
      render();
      completeSweep();
      expect(text()).toContain("Plotting");

      render([message]);
      expect(text()).toContain(message);
      completeSweep();
      expect(text()).toContain(message);
    },
  );

  it("keeps cycling after switching to a shorter override list", () => {
    render(["First", "Second", "Third"]);
    completeSweep();
    completeSweep();
    expect(text()).toContain("Third");

    render(["Short first", "Short second"]);
    expect(text()).toContain("Short first");
    completeSweep();
    expect(text()).toContain("Short second");
    completeSweep();
    expect(text()).toContain("Short first");
  });

  it("restores defaults after advancing beyond their length in an override list", () => {
    render(Array.from({ length: 7 }, (_, index) => `Step ${index}`));
    for (let index = 0; index < 6; index++) completeSweep();
    expect(text()).toContain("Step 6");

    render();
    expect(text()).toContain("Scheming");
    completeSweep();
    expect(text()).toContain("Plotting");
  });

  it("uses the default messages for an empty override list", () => {
    render([]);
    expect(text()).toContain("Scheming");
    completeSweep();
    expect(text()).toContain("Plotting");
  });
});
