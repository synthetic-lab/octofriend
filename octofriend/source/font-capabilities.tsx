import React, { createContext, useContext, useEffect, useState } from "react";
import { useApp } from "paintcannon-react";
import type { FontChangeEventType, NerdFontSet } from "paintcannon";

export type FontCapabilities = Readonly<Record<NerdFontSet | "legacyComputing", boolean>>;

const FontCapabilitiesContext = createContext<FontCapabilities | null>(null);

export function useFontCapabilities(): FontCapabilities {
  const capabilities = useContext(FontCapabilitiesContext);
  if (capabilities == null) throw new Error("Font capabilities are not initialized.");
  return capabilities;
}

export function FontCapabilitiesProvider({ children }: { children: React.ReactNode }) {
  const { paintCannon, exit } = useApp();
  const [capabilities, setCapabilities] = useState<FontCapabilities | null>(null);

  useEffect(() => {
    const font = paintCannon.font;
    let snapshot: FontCapabilities = {
      powerline: false,
      "powerline-extended": false,
      "font-awesome": false,
      devicons: false,
      "material-design": false,
      legacyComputing: false,
    };
    let seeded = false;
    let disposed = false;
    const cleanups: Array<() => void> = [];
    const dispose = () => {
      disposed = true;
      for (const cleanup of cleanups.splice(0)) cleanup();
    };
    const update = (key: keyof FontCapabilities, supported: boolean) => {
      if (disposed || snapshot[key] === supported) return;
      snapshot = { ...snapshot, [key]: supported };
      if (seeded) setCapabilities(snapshot);
    };
    const checks: Array<{
      key: keyof FontCapabilities;
      event: FontChangeEventType;
      read: () => Promise<boolean>;
    }> = [
      ...(
        ["powerline", "powerline-extended", "font-awesome", "devicons", "material-design"] as const
      ).map(set => ({
        key: set,
        event: `nerdfont-${set}-change` as const,
        read: () => font.hasNerdFontSet(set),
      })),
      {
        key: "legacyComputing",
        event: "symbols-for-legacy-computing-change",
        read: () => font.hasSymbolsForLegacyComputing(),
      },
    ];

    void Promise.all(
      checks.map(async ({ key, event, read }) => {
        let changed = false;
        const listener = ({ supported }: { supported: boolean }) => {
          changed = true;
          update(key, supported);
        };
        // Subscribe before reading, and don't overwrite a newer event with an older query.
        font.addEventListener(event, listener);
        cleanups.push(() => font.removeEventListener(event, listener));
        const supported = await read();
        if (!changed) update(key, supported);
      }),
    ).then(
      () => {
        if (disposed) return;
        seeded = true;
        setCapabilities(snapshot);
      },
      error => {
        if (disposed) return;
        dispose();
        exit(error instanceof Error ? error : new Error(String(error)));
      },
    );
    return dispose;
  }, [paintCannon, exit]);

  // Don't mount the app with guessed capabilities, especially a large resumed transcript.
  if (capabilities == null) return null;
  return (
    <FontCapabilitiesContext.Provider value={capabilities}>
      {children}
    </FontCapabilitiesContext.Provider>
  );
}
