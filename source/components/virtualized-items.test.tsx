import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it } from "bun:test";
import { withMock } from "antipattern";
import {
  DOMRectReadOnly,
  type DivElement,
  type PaintElement,
  type PaintCannon,
  type IntersectionObserver,
  type IntersectionObserverCallback,
  type IntersectionObserverInit,
  type IntersectionObserverEntry,
} from "paintcannon";
import { Span } from "paintcannon-react";
import { AppContext } from "paintcannon-react/dist/src/hooks/use-app.js";
import { TerminalFlex } from "./terminal-flex.tsx";
import { VirtualizedItems, virtualizedItemsDeps } from "./virtualized-items.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type Item = { id: number; height: number };
type Node = PaintElement & { itemId?: number };
const getKey = (item: Item) => item.id;
function Row({ item }: { item: Item }) {
  return <Span>{`row ${item.id}`}</Span>;
}

class Observer {
  targets = new Set<Node>();
  states = new Map<Node, boolean>();
  observations = new Map<Node, number>();
  disconnected = false;
  lastEntries: IntersectionObserverEntry[] = [];
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit,
  ) {}
  observe(target: PaintElement) {
    this.targets.add(target);
    this.observations.set(target, (this.observations.get(target) ?? 0) + 1);
  }
  unobserve(target: PaintElement) {
    this.targets.delete(target);
    this.states.delete(target);
  }
  disconnect() {
    this.disconnected = true;
    this.targets.clear();
  }
  emit(entries: IntersectionObserverEntry[]) {
    this.lastEntries = entries;
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

async function withList(test: (harness: ReturnType<typeof createHarness>) => void) {
  const harness = createHarness();
  await withMock(virtualizedItemsDeps, "createObserver", harness.createObserver, async () => {
    try {
      test(harness);
    } finally {
      harness.unmount();
    }
  });
}

function createHarness() {
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  let items: readonly Item[] = [];
  let width = 80;
  let viewportHeight = 10;
  let heightMultiplier = 1;
  let time = 0;
  const observers: Observer[] = [];
  const measurements = new Map<number, number>();
  const resizeListeners = new Set<() => void>();
  const frames = new Map<number, () => void>();
  let frameId = 0;
  const root = {
    get clientHeight() {
      return viewportHeight;
    },
    get scrollTop(): number {
      throw new Error("The virtualizer must not read scrollTop");
    },
    set scrollTop(_value: number) {
      throw new Error("The virtualizer must not set scrollTop");
    },
  } as DivElement;
  const rootRef = { current: root };
  const paintCannon = {
    addEventListener: (_type: string, callback: () => void) => resizeListeners.add(callback),
    removeEventListener: (_type: string, callback: () => void) => resizeListeners.delete(callback),
    requestAnimationFrame: (callback: () => void) => {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  } as unknown as PaintCannon;
  const harness = {
    observers,
    measurements,
    resizeListeners,
    frames,
    createObserver(callback: IntersectionObserverCallback, options: IntersectionObserverInit) {
      const observer = new Observer(callback, options);
      observers.push(observer);
      return observer;
    },
    render(nextItems: readonly Item[] = items, key = "list") {
      items = nextItems;
      const tree = (
        <AppContext.Provider value={{ paintCannon, exit() {}, waitUntilExit: async () => {} }}>
          <VirtualizedItems items={items} getKey={getKey} rootRef={rootRef} key={key}>
            {item => <Row item={item} />}
          </VirtualizedItems>
        </AppContext.Provider>
      );
      act(() => {
        if (renderer) renderer.update(tree);
        else {
          renderer = TestRenderer.create(tree, {
            createNodeMock(element) {
              const props = element.props as {
                children?: React.ReactNode;
                style?: { height?: number };
              };
              const child = props.children;
              const item = React.isValidElement<{ item?: Item }>(child)
                ? child.props.item
                : undefined;
              return {
                itemId: item?.id,
                get clientWidth() {
                  return width;
                },
                get clientHeight() {
                  if (!item) return props.style?.height ?? 0;
                  measurements.set(item.id, (measurements.get(item.id) ?? 0) + 1);
                  return item.height * heightMultiplier;
                },
              };
            },
          });
        }
      });
    },
    rows() {
      return renderer!.root.findAllByType(Row).map(node => (node.props["item"] as Item).id);
    },
    spacers() {
      return renderer!.root
        .findAllByType(TerminalFlex)
        .map(node => node.props["style"].height as number | undefined)
        .filter((height): height is number => height !== undefined);
    },
    totalHeight() {
      return (
        harness.spacers().reduce((sum, height) => sum + height, 0) +
        harness
          .rows()
          .reduce(
            (sum, id) => sum + items.find(item => item.id === id)!.height * heightMultiplier,
            0,
          )
      );
    },
    // viewportTop is relative to the list, not the scroller. A changing header can move it
    // without any scroll event. Emit only initial observations and actual edge crossings.
    observe(viewportTop: number) {
      time++;
      const observer = observers[observers.length - 1];
      const margin = Number.parseFloat(observer.options.rootMargin!);
      const rootBounds = new DOMRectReadOnly(0, 7 - margin, width, viewportHeight + margin * 2);
      const spacers = harness.spacers();
      const blankTargets = [...observer.targets].filter(target => target.itemId === undefined);
      const total = items.reduce((sum, item) => sum + item.height * heightMultiplier, 0);
      const entries: IntersectionObserverEntry[] = [];
      for (const target of observer.targets) {
        let offset = 0;
        let height = 0;
        if (target.itemId === undefined) {
          const first = target === blankTargets[0];
          height = first ? spacers[0] : spacers[spacers.length - 1];
          offset = first ? 0 : total - height;
        } else {
          for (const item of items) {
            if (item.id === target.itemId) {
              height = item.height * heightMultiplier;
              break;
            }
            offset += item.height * heightMultiplier;
          }
        }
        const rect = new DOMRectReadOnly(0, 7 + offset - viewportTop, width, height);
        const isIntersecting = rect.bottom >= rootBounds.top && rect.top <= rootBounds.bottom;
        if (observer.states.get(target) === isIntersecting) continue;
        observer.states.set(target, isIntersecting);
        entries.push({
          target,
          time,
          rootBounds,
          boundingClientRect: rect,
          intersectionRect: rect,
          isIntersecting,
          intersectionRatio: isIntersecting ? 1 : 0,
        });
      }
      if (entries.length) act(() => observer.emit(entries));
      return entries;
    },
    settle(viewportTop: number) {
      for (let frame = 0; frame < 10; frame++) {
        if (harness.observe(viewportTop).length === 0) return;
      }
      throw new Error("Window did not settle");
    },
    resize(nextWidth: number, nextHeight = viewportHeight, multiplier = heightMultiplier) {
      width = nextWidth;
      viewportHeight = nextHeight;
      heightMultiplier = multiplier;
      act(() => {
        for (const listener of resizeListeners) listener();
        const callbacks = [...frames.values()];
        frames.clear();
        for (const callback of callbacks) callback();
      });
    },
    unmount() {
      act(() => renderer?.unmount());
      renderer = undefined;
    },
  };
  return harness;
}

const manyItems = (count = 100) => Array.from({ length: count }, (_, id) => ({ id, height: 2 }));

describe("VirtualizedItems", () => {
  it("measures once, keeps a bounded observed window, and preserves total height", async () => {
    await withList(h => {
      h.render(manyItems(1000));
      expect(h.measurements.size).toBe(1000);
      h.settle(1000);
      expect(h.rows()).toEqual(Array.from({ length: 25 }, (_, i) => 490 + i));
      expect(h.spacers()).toEqual([980, 970]);
      expect(h.totalHeight()).toBe(2000);
      expect(h.observers).toHaveLength(1);
      expect(h.observers[0].targets.size).toBe(27);
      h.settle(0);
      h.settle(1000);
      expect([...h.measurements.values()].every(count => count === 1)).toBe(true);
      expect(h.totalHeight()).toBe(2000);
    });
  });

  it("slides the window on item crossings before either spacer approaches", async () => {
    await withList(h => {
      h.render(manyItems());
      h.settle(60);
      const observer = h.observers[0];
      const retained = [...observer.targets].find(target => target.itemId === 30)!;
      const before = h.rows();
      const entries = h.observe(64);
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every(entry => (entry.target as Node).itemId !== undefined)).toBe(true);
      expect(h.rows()).not.toEqual(before);
      h.settle(64);
      expect(h.rows()).toContain(45); // ahead of the actual viewport's end at row 74
      expect(observer.observations.get(retained)).toBe(1);
      expect(h.observers).toHaveLength(1);
      expect(h.totalHeight()).toBe(200);
    });
  });

  it("recovers jumps in both directions using spacers, with natural exit/reentry", async () => {
    await withList(h => {
      h.render(manyItems(1000));
      h.settle(0);
      h.settle(1800);
      expect(h.rows()).toContain(900);
      h.settle(100);
      expect(h.rows()).toContain(50);
      h.settle(1800);
      expect(h.rows()).toContain(900);
      const observer = h.observers[0];
      for (const target of observer.targets) {
        if (target.itemId === undefined) expect(observer.observations.get(target)).toBe(1);
      }
      expect(h.totalHeight()).toBe(2000);
    });
  });

  it("uses the newest geometry when native frames are delivered in one batch", async () => {
    await withList(h => {
      h.render(manyItems(1000));
      h.settle(60);
      h.observe(64);
      const observer = h.observers[0];
      const queued: IntersectionObserverEntry[] = [];
      const emit = observer.emit.bind(observer);
      observer.emit = entries => {
        queued.push(...entries);
      };
      h.observe(64); // initial entries for newly mounted items
      h.observe(1800); // a jump before JS delivers those entries
      observer.emit = emit;
      act(() => emit(queued));
      h.settle(1800);
      expect(h.rows()).toContain(900);
      expect(h.totalHeight()).toBe(2000);
    });
  });

  it("handles a list offset, variable heights, very tall items, and empty items", async () => {
    await withList(h => {
      h.render([
        { id: 0, height: 0 },
        { id: 1, height: 1000 },
        { id: 2, height: 3 },
      ]);
      h.settle(-100); // the list is below the viewport
      expect(h.rows()).toEqual([]);
      h.settle(500); // jump into the middle of a single tall item
      expect(h.rows()).toEqual([1]);
      expect(h.totalHeight()).toBe(1003);
      h.settle(1000);
      expect(h.rows()).toEqual([1, 2]);
      expect(h.measurements.get(0)).toBe(1);
    });
  });

  it("measures appended items without remounting old hidden rows", async () => {
    await withList(h => {
      const items = manyItems();
      h.render(items);
      h.settle(0);
      h.render([...items, { id: 100, height: 7 }]);
      h.settle(0);
      expect(h.measurements.get(100)).toBe(1);
      expect(h.rows()).not.toContain(100);
      expect(h.rows()).toContain(0);
      expect(h.totalHeight()).toBe(207);
      expect([...h.measurements.values()].every(count => count === 1)).toBe(true);
      h.settle(200);
      expect(h.rows()).toContain(100);
    });
  });

  it("supports truncation, empty lists, and session resets", async () => {
    await withList(h => {
      h.render(manyItems());
      h.settle(180);
      h.render(manyItems(5));
      h.settle(0);
      expect(h.rows()).toEqual([0, 1, 2, 3, 4]);
      expect(h.totalHeight()).toBe(10);
      h.render([]);
      h.settle(0);
      expect(h.totalHeight()).toBe(0);
      h.render([{ id: 0, height: 8 }], "new-session");
      h.settle(0);
      expect(h.totalHeight()).toBe(8);
    });
  });

  it("remeasures on width changes but not height-only resizes, without scrolling", async () => {
    await withList(h => {
      h.render(manyItems());
      h.settle(60);
      h.resize(80, 20);
      h.settle(60);
      expect([...h.measurements.values()].every(count => count === 1)).toBe(true);
      h.resize(40, 20, 2);
      h.settle(60);
      expect(h.rows()).toContain(15);
      expect(h.totalHeight()).toBe(400);
      expect([...h.measurements.values()].every(count => count === 2)).toBe(true);
      expect(h.observers.slice(0, -1).every(observer => observer.disconnected)).toBe(true);
    });
  });

  it("disconnects and ignores queued callbacks after unmount", async () => {
    await withList(h => {
      h.render(manyItems());
      const entries = h.observe(0);
      const observer = h.observers[0];
      h.unmount();
      expect(observer.disconnected).toBe(true);
      expect(h.resizeListeners.size).toBe(0);
      expect(h.frames.size).toBe(0);
      expect(() => observer.emit(entries)).not.toThrow();
    });
  });
});
