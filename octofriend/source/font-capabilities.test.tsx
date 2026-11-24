import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it, mock } from "bun:test";
import type { FontChangeEventListener, FontChangeEventType, PaintCannon } from "paintcannon";
import { Span } from "paintcannon-react";
import { AppContext } from "paintcannon-react/dist/src/hooks/use-app.js";
import {
  FontCapabilitiesProvider,
  useFontCapabilities,
  type FontCapabilities,
} from "./font-capabilities.tsx";
import { TopLeftCorner } from "./components/corner.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type Capability = keyof FontCapabilities;

function createHarness() {
  const reads: Capability[] = [];
  const pending = new Map<
    Capability,
    { resolve: (supported: boolean) => void; reject: (error: Error) => void }
  >();
  const listeners = new Map<FontChangeEventType, Set<FontChangeEventListener>>();
  const snapshots: FontCapabilities[] = [];
  const read = (key: Capability) => {
    reads.push(key);
    return new Promise<boolean>((resolve, reject) => pending.set(key, { resolve, reject }));
  };
  const font: PaintCannon["font"] = {
    hasNerdFontSet: read,
    hasSymbolsForLegacyComputing: () => read("legacyComputing"),
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
  };
  const app = {
    paintCannon: { font } as PaintCannon,
    exit: mock(),
    waitUntilExit: async () => {},
  };
  let renderer: TestRenderer.ReactTestRenderer | null = null;

  function Consumer() {
    const capabilities = useFontCapabilities();
    snapshots.push(capabilities);
    // Like the HUD, mount the corner only after confirming support. It must not check again.
    return capabilities.legacyComputing ? <TopLeftCorner color="white" /> : null;
  }

  return {
    reads,
    pending,
    listeners,
    snapshots,
    exit: app.exit,
    render(consumers = 1) {
      const tree = (
        <AppContext.Provider value={app}>
          <FontCapabilitiesProvider>
            {Array.from({ length: consumers }, (_, index) => (
              <Consumer key={index} />
            ))}
          </FontCapabilitiesProvider>
        </AppContext.Provider>
      );
      act(() => {
        if (renderer) renderer.update(tree);
        else renderer = TestRenderer.create(tree);
      });
    },
    async seed(supported: boolean) {
      await act(async () => {
        for (const check of pending.values()) check.resolve(supported);
      });
    },
    emit(key: Capability, supported: boolean) {
      const type: FontChangeEventType =
        key === "legacyComputing"
          ? "symbols-for-legacy-computing-change"
          : `nerdfont-${key}-change`;
      act(() => {
        for (const listener of listeners.get(type) ?? []) {
          listener({ type, supported, target: font, currentTarget: font });
        }
      });
    },
    glyphs() {
      return renderer!.root.findAllByType(Span).map(node => node.props["children"]);
    },
    unmount() {
      act(() => renderer?.unmount());
      renderer = null;
    },
  };
}

describe("FontCapabilitiesProvider", () => {
  it("waits for the complete seed and renders supported corners correctly on their first mount", async () => {
    const h = createHarness();
    try {
      h.render();
      expect(h.reads).toEqual([
        "powerline",
        "powerline-extended",
        "font-awesome",
        "devicons",
        "material-design",
        "legacyComputing",
      ]);
      expect(h.snapshots).toEqual([]);
      await act(async () => {
        h.pending.get("powerline")!.resolve(true);
      });
      expect(h.snapshots).toEqual([]);
      await h.seed(true);
      expect(h.snapshots).toHaveLength(1);
      expect(Object.values(h.snapshots[0]).every(Boolean)).toBe(true);
      expect(h.glyphs()).toEqual([String.fromCodePoint(0x1fb41)]);

      h.render(2);
      expect(h.glyphs()).toEqual([String.fromCodePoint(0x1fb41), String.fromCodePoint(0x1fb41)]);
      expect(h.reads).toHaveLength(6);
      expect([...h.listeners.values()].map(set => set.size)).toEqual([1, 1, 1, 1, 1, 1]);
    } finally {
      h.unmount();
    }
    expect([...h.listeners.values()].every(set => set.size === 0)).toBe(true);
  });

  it("renders confirmed false values and shares live upgrades and downgrades without remounting", async () => {
    const h = createHarness();
    try {
      h.render(2);
      await h.seed(false);
      expect(h.snapshots).toHaveLength(2);
      expect(Object.values(h.snapshots[0]).every(value => !value)).toBe(true);
      const initial = h.snapshots[0];
      h.emit("powerline-extended", true);
      expect(h.snapshots.at(-1)).toEqual({ ...initial, "powerline-extended": true });
      expect(h.snapshots.at(-1)).toBe(h.snapshots.at(-2));
      h.emit("legacyComputing", true);
      expect(h.glyphs()).toHaveLength(2);
      expect(h.snapshots.at(-1)?.powerline).toBe(false);
      h.emit("powerline-extended", false);
      expect(h.snapshots.at(-1)?.["powerline-extended"]).toBe(false);
      expect(h.snapshots.at(-1)?.legacyComputing).toBe(true);
      h.emit("legacyComputing", false);
      expect(h.glyphs()).toEqual([]);
      expect(initial.legacyComputing).toBe(false);
      expect(h.reads).toHaveLength(6);
    } finally {
      h.unmount();
    }
  });

  it("does not overwrite events received during seeding with stale query results", async () => {
    const h = createHarness();
    try {
      h.render();
      h.emit("powerline", true);
      h.emit("powerline", false);
      h.emit("legacyComputing", true);
      h.emit("legacyComputing", false);
      await h.seed(true);
      expect(h.snapshots[0].powerline).toBe(false);
      expect(h.snapshots[0].legacyComputing).toBe(false);
      expect(h.snapshots[0]["material-design"]).toBe(true);
    } finally {
      h.unmount();
    }
  });

  it("removes subscriptions on unmount and ignores pending queries and queued events", async () => {
    const h = createHarness();
    h.render();
    const queued = [...h.listeners.get("nerdfont-powerline-change")!][0];
    h.unmount();
    expect([...h.listeners.values()].every(set => set.size === 0)).toBe(true);
    await act(async () => {
      h.pending.get("powerline")!.reject(new Error("cancelled"));
    });
    await h.seed(true);
    queued({ supported: true } as Parameters<FontChangeEventListener>[0]);
    expect(h.snapshots).toEqual([]);
    expect(h.exit).not.toHaveBeenCalled();
  });

  it("exits through the renderer on a failed seed and releases subscriptions", async () => {
    const h = createHarness();
    try {
      h.render();
      const error = new Error("font detection failed");
      await act(async () => {
        h.pending.get("legacyComputing")!.reject(error);
      });
      expect(h.exit).toHaveBeenCalledWith(error);
      expect([...h.listeners.values()].every(set => set.size === 0)).toBe(true);
      await h.seed(true);
      expect(h.snapshots).toEqual([]);
    } finally {
      h.unmount();
    }
  });

  it("does not share capabilities between renderer instances", async () => {
    const first = createHarness();
    const second = createHarness();
    try {
      first.render();
      second.render();
      await first.seed(true);
      expect(second.snapshots).toEqual([]);
      await second.seed(false);
      expect(first.snapshots[0].powerline).toBe(true);
      expect(second.snapshots[0].powerline).toBe(false);
    } finally {
      first.unmount();
      second.unmount();
    }
  });
});
