import { useEffect, useState } from "react";
import { useApp } from "paintcannon-react";

/**
 * Whether the terminal can render the Symbols for Legacy Computing set (smooth mosaic
 * corners etc.), refreshed live. Independent of NERD_FONT detection.
 */
export function useLegacyComputingSymbols(): boolean {
  const { paintCannon } = useApp();
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Read the initial value: change listeners only fire on changes.
    void paintCannon.font.hasSymbolsForLegacyComputing().then(value => {
      if (!cancelled) setSupported(value);
    });
    const listener = (event: { supported: boolean }) => setSupported(event.supported);
    paintCannon.font.addEventListener("symbols-for-legacy-computing-change", listener);
    return () => {
      cancelled = true;
      paintCannon.font.removeEventListener("symbols-for-legacy-computing-change", listener);
    };
  }, [paintCannon]);

  return supported;
}
