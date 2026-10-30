import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, describe, expect, it } from "bun:test";
import { Span } from "paintcannon-react";
import { AnimationContext } from "paintcannon-react/dist/src/hooks/use-animation.js";
import { useShimmerlock } from "../hooks/use-shimmerlock.ts";
import Shimmer, { type ShimmerEndEvent } from "./shimmer.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let renderer: TestRenderer.ReactTestRenderer | undefined;
let time = 0;
const subscribers = new Set<(time: number) => void>();
const completions: ShimmerEndEvent[] = [];
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

function Harness({ text, running }: { text: string; running: boolean }) {
  const lock = useShimmerlock("explore-subagent");
  return (
    <AnimationContext.Provider value={animation}>
      <Shimmer
        segments={[{ text, from: "#000000", to: "#ffffff" }]}
        lock={lock}
        running={running}
        onShimmerEnd={event => {
          completions.push(event);
        }}
      />
    </AnimationContext.Provider>
  );
}

function render(text: string, running = true) {
  act(() => {
    if (renderer == null) {
      renderer = TestRenderer.create(<Harness text={text} running={running} />);
    } else {
      renderer.update(<Harness text={text} running={running} />);
    }
  });
}

function advance(frames: number) {
  time += frames * 60;
  act(() => {
    for (const callback of subscribers) callback(time);
  });
}

function colors(): string[] {
  return renderer!.root
    .findAllByType(Span)
    .filter(node => node.children.length === 1 && typeof node.children[0] === "string")
    .map(node => node.props["style"].color);
}

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  time = 0;
  subscribers.clear();
  completions.length = 0;
});

describe("Shimmer text changes", () => {
  it("preserves the sweep position and extends it over longer text", () => {
    render("abcdefgh");
    advance(22);
    const before = colors();
    expect(before[2]).toBe("#ffffff");
    expect(completions).toEqual([{ holdsShimmerlock: true }]);

    render("abcdefghijklmnop");
    expect(colors().slice(0, before.length)).toEqual(before);
    expect(completions).toHaveLength(1);

    advance(10);
    expect(colors()[12]).toBe("#ffffff");
    expect(completions).toHaveLength(1);
    advance(8);
    expect(completions).toHaveLength(2);
  });

  it("finishes the current sweep before using the shorter text's cycle length", () => {
    render("abcdefghijklmnopqrst");
    advance(36);
    const before = colors();
    expect(before[4]).toBe("#ffffff");
    expect(completions).toHaveLength(1);

    render("abcdefgh");
    expect(colors()).toEqual(before.slice(0, 8));
    expect(completions).toHaveLength(1);

    advance(8);
    expect(colors()).toEqual(Array(8).fill("#000000"));
    expect(completions).toHaveLength(1);
    advance(12);
    expect(completions).toHaveLength(2);
    advance(8);
    expect(colors()[4]).toBe("#ffffff");
    advance(8);
    expect(completions).toHaveLength(3);
  });

  it("preserves the fading wave across text changes and restarts when resumed", () => {
    render("abcdefghijklmnopqrst");
    advance(34);
    render("abcdefghijklmnopqrst", false);
    const before = colors();
    expect(before[2]).toBe("#ffffff");

    render("abcdefghijkl", false);
    expect(colors()).toEqual(before.slice(0, 12));
    advance(1);
    expect(colors()[3]).toBe("#e0e0e0");
    advance(8);
    expect(colors()).toEqual(Array(12).fill("#000000"));
    expect(completions).toHaveLength(1);

    render("abcdefghijkl");
    expect(colors()).toEqual(Array(12).fill("#000000"));
    advance(6);
    expect(colors()[2]).toBe("#ffffff");
    expect(completions).toHaveLength(1);
    advance(14);
    expect(completions).toHaveLength(2);
  });
});
