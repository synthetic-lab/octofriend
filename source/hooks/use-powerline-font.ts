import { useEffect, useState } from "react";
import { useApp } from "paintcannon-react";
import type { NerdFontSet } from "paintcannon";

/**
 * Whether the terminal has the given Nerd Font set installed, refreshed live: paintcannon
 * re-probes periodically and emits change events, and honors the NERD_FONT=0/1 override.
 * Starts out false (paintcannon's detection is conservative) and flips true once confirmed.
 */
export function usePowerlineFont(set: NerdFontSet = "powerline"): boolean {
  const { paintCannon } = useApp();
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Read the initial value: change listeners only fire on changes.
    void paintCannon.font.hasNerdFontSet(set).then(value => {
      if (!cancelled) setSupported(value);
    });
    const listener = (event: { supported: boolean }) => setSupported(event.supported);
    paintCannon.font.addEventListener(`nerdfont-${set}-change`, listener);
    return () => {
      cancelled = true;
      paintCannon.font.removeEventListener(`nerdfont-${set}-change`, listener);
    };
  }, [paintCannon, set]);

  return supported;
}
