import React, { useLayoutEffect, useEffect, useMemo, useRef, useState } from "react";
import {
  IntersectionObserver,
  type IntersectionObserverCallback,
  type IntersectionObserverInit,
  type IntersectionObserverEntry,
  type PaintElement,
  type DivElement,
} from "paintcannon";
import { registry } from "antipattern";
import { useApp } from "paintcannon-react";
import { TerminalFlex } from "./terminal-flex.tsx";

type Observer = Pick<IntersectionObserver, "observe" | "unobserve" | "disconnect">;

export const virtualizedItemsDeps = registry({
  createObserver: (
    callback: IntersectionObserverCallback,
    options: IntersectionObserverInit,
  ): Observer => new IntersectionObserver(callback, options),
});

type Target = { offset: number; itemKey?: React.Key };
type Observation = {
  targets: Map<PaintElement, Target>;
  observer: Observer | null;
};
type Viewport = { top: number; bottom: number };
type Range = { start: number; end: number };
type Props<T> = {
  items: readonly T[];
  getKey: (item: T) => React.Key;
  rootRef: React.RefObject<DivElement | null>;
  /** Extra screens to render on each side of the viewport. Defaults to two. */
  overscanScreens?: number;
  children: (item: T) => React.ReactNode;
};

/**
 * Virtualizes height, not scrolling. Items must have stable keys and constant heights
 * at a given width. Terminal resizes remeasure when the available width changes;
 * remount this component for other changes that invalidate item heights.
 * New items render once to measure. Offscreen items unmount, including their local state.
 */
export function VirtualizedItems<T>({
  items,
  getKey,
  rootRef,
  overscanScreens = 2,
  children,
}: Props<T>) {
  const { paintCannon } = useApp();
  const containerRef = useRef<DivElement>(null);
  const measuredWidth = useRef<number | null>(null);
  const heights = useRef(new Map<React.Key, number>());
  const [measurementVersion, setMeasurementVersion] = useState(0);
  const [resizeVersion, setResizeVersion] = useState(0);
  const [, updateWindow] = useState(0);
  const viewport = useRef<Viewport | null>(null);
  const observation = useMemo<Observation>(() => ({ targets: new Map(), observer: null }), []);

  useEffect(() => {
    let frame: number | undefined;
    const resize = () => {
      if (frame !== undefined) paintCannon.cancelAnimationFrame(frame);
      frame = paintCannon.requestAnimationFrame(() => {
        frame = undefined;
        const width = containerRef.current?.clientWidth;
        if (width !== undefined && width !== measuredWidth.current) {
          heights.current.clear();
          measuredWidth.current = width;
          viewport.current = null;
          setMeasurementVersion(version => version + 1);
        }
        // Recalculate the observer margin and get fresh geometry even for height-only resizes.
        setResizeVersion(version => version + 1);
      });
    };
    paintCannon.addEventListener("resize", resize);
    return () => {
      paintCannon.removeEventListener("resize", resize);
      if (frame !== undefined) paintCannon.cancelAnimationFrame(frame);
    };
  }, [paintCannon]);

  // Rebuild metadata only when the items or their initial measurements change, not on scroll.
  const layout = useMemo(() => {
    const entries: Array<{ key: React.Key; item: T }> = [];
    const offsets = [0];
    const unmeasured: number[] = [];
    const keys = new Set<React.Key>();
    for (const item of items) {
      const key = getKey(item);
      keys.add(key);
      const height = heights.current.get(key);
      // Empty items contribute no height and need no mounted host node or observation.
      if (height === 0) continue;
      if (height === undefined) unmeasured.push(entries.length);
      entries.push({ key, item });
      offsets.push(offsets[offsets.length - 1] + (height ?? 0));
    }
    return { entries, offsets, unmeasured, keys };
  }, [items, getKey, measurementVersion]);

  const range = visibleRange(layout.offsets, viewport.current);
  const committed = useRef({ layout, range });
  useLayoutEffect(() => {
    committed.current = { layout, range };
  });

  useLayoutEffect(() => {
    for (const key of heights.current.keys()) {
      if (!layout.keys.has(key)) heights.current.delete(key);
    }
  }, [layout]);

  useLayoutEffect(() => {
    if (measuredWidth.current === null) measuredWidth.current = containerRef.current!.clientWidth;
    let measured = false;
    for (const [element, target] of observation.targets) {
      if (target.itemKey === undefined || heights.current.has(target.itemKey)) continue;
      // Our wrappers have no borders/margins, so clientHeight is their full layout height.
      heights.current.set(target.itemKey, element.clientHeight);
      measured = true;
    }
    if (measured) setMeasurementVersion(version => version + 1);
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Half the overscan is the trigger region; the other half is the replenished buffer.
    // Paintcannon's rootMargin px units are terminal cells, not screen pixels.
    const margin = Math.max(1, Math.ceil((root.clientHeight * overscanScreens) / 2));
    let active = true;
    const observer = virtualizedItemsDeps.createObserver(
      entries => {
        if (!active) return;
        // Native frames can accumulate before JS receives a batch. Use the newest
        // geometry, preferring stable item offsets over spacers within that frame.
        let entry: IntersectionObserverEntry | undefined;
        for (const candidate of entries) {
          const target = observation.targets.get(candidate.target);
          if (!target || !candidate.rootBounds) continue;
          if (
            !entry ||
            candidate.time > entry.time ||
            (candidate.time === entry.time && target.itemKey !== undefined)
          ) {
            entry = candidate;
          }
        }
        if (!entry?.rootBounds) return;
        const target = observation.targets.get(entry.target)!;
        const origin = target.offset - entry.boundingClientRect.top;
        const nextViewport = {
          top: origin + entry.rootBounds.top - margin,
          bottom: origin + entry.rootBounds.bottom + margin,
        };
        viewport.current = nextViewport;
        const current = committed.current;
        const next = visibleRange(current.layout.offsets, nextViewport);
        if (next.start !== current.range.start || next.end !== current.range.end) {
          updateWindow(version => version + 1);
        }
      },
      { root, rootMargin: `${margin}px 0px`, threshold: 0 },
    );
    observation.observer = observer;
    for (const element of observation.targets.keys()) observer.observe(element);
    return () => {
      active = false;
      observation.observer = null;
      observer.disconnect();
    };
  }, [rootRef, overscanScreens, observation, resizeVersion]);

  // Unmeasured additions must render even when the user is browsing elsewhere in history.
  const mounted = new Set(layout.unmeasured);
  for (let index = range.start; index < range.end; index++) mounted.add(index);
  const indices = [...mounted].sort((a, b) => a - b);
  const first = indices[0] ?? range.start;
  const content: React.ReactNode[] = [
    <ObservedBox key="top" observation={observation} offset={0} height={layout.offsets[first]} />,
  ];
  let cursor = first;
  for (const index of indices) {
    const entry = layout.entries[index];
    if (index > cursor) {
      content.push(
        <ObservedBox
          key={`gap:${String(entry.key)}`}
          observation={observation}
          offset={layout.offsets[cursor]}
          height={layout.offsets[index] - layout.offsets[cursor]}
        />,
      );
    }
    content.push(
      <ObservedBox
        key={`item:${String(entry.key)}`}
        observation={observation}
        offset={layout.offsets[index]}
        itemKey={entry.key}
      >
        {children(entry.item)}
      </ObservedBox>,
    );
    cursor = index + 1;
  }
  content.push(
    <ObservedBox
      key="bottom"
      observation={observation}
      offset={layout.offsets[cursor]}
      height={layout.offsets[layout.entries.length] - layout.offsets[cursor]}
    />,
  );
  return (
    <TerminalFlex
      ref={containerRef}
      style={{ flexDirection: "column", flexShrink: 0, minWidth: 0 }}
    >
      {content}
    </TerminalFlex>
  );
}

function ObservedBox({
  observation,
  offset,
  itemKey,
  height,
  children,
}: {
  observation: Observation;
  offset: number;
  itemKey?: React.Key;
  height?: number;
  children?: React.ReactNode;
}) {
  const ref = useRef<DivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current!;
    observation.targets.set(element, { offset, itemKey });
    observation.observer?.observe(element);
    return () => {
      observation.observer?.unobserve(element);
      observation.targets.delete(element);
    };
  }, [observation]);
  useLayoutEffect(() => {
    // Moving a spacer does not rearm it: its exit/entry transitions are sufficient.
    observation.targets.set(ref.current!, { offset, itemKey });
  }, [observation, offset, itemKey]);
  return (
    <TerminalFlex ref={ref} style={{ flexDirection: "column", flexShrink: 0, minWidth: 0, height }}>
      {children}
    </TerminalFlex>
  );
}

function visibleRange(offsets: readonly number[], viewport: Viewport | null): Range {
  const count = offsets.length - 1;
  if (!viewport) return { start: 0, end: count };
  // First item whose bottom is after the start of the window.
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (offsets[middle + 1] <= viewport.top) low = middle + 1;
    else high = middle;
  }
  const start = low;
  // First item whose top is at or after the end of the window (exclusive).
  high = count;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (offsets[middle] < viewport.bottom) low = middle + 1;
    else high = middle;
  }
  return { start, end: low };
}
