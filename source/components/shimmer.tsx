import React, { useEffect, useRef, useState } from "react";
import { Span, useAnimation } from "paintcannon-react";
import { useShimmerlockOwnershipCheck } from "../hooks/use-shimmerlock.ts";

export type ShimmerSegment = {
  text: string;
  from: string;
  to: string;
};

type Props = {
  segments: Array<ShimmerSegment>;
  lock: symbol;
  running: boolean;
};

const INTERVAL_MS = 60;
const WAVE_WIDTH = 4;
const FADE_OUT_MS = 500;

type Rgb = [number, number, number];

function parseHex(color: string): Rgb | null {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (match == null) return null;
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function mix(from: Rgb, to: Rgb, t: number): string {
  const channel = (index: number) =>
    Math.round(from[index] + (to[index] - from[index]) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

function Shimmer({ segments, lock, running }: Props) {
  const ownsLock = useShimmerlockOwnershipCheck(lock);
  const shouldRun = running && ownsLock;
  const characters = segments.flatMap(({ text, from, to }) => {
    const fromRgb = parseHex(from);
    const toRgb = parseHex(to);
    return text.split("").map(char => ({ char, from, fromRgb, toRgb }));
  });
  const [animating, setAnimating] = useState(shouldRun);
  const fadeStartRef = useRef<{ time: number; frame: number } | null>(null);
  const { frame, time } = useAnimation({ isActive: animating, interval: INTERVAL_MS });
  const cycle = characters.length + 2 * WAVE_WIDTH;

  useEffect(() => {
    if (shouldRun) {
      fadeStartRef.current = null;
      setAnimating(true);
      return;
    }
    if (!animating || fadeStartRef.current != null) return;
    fadeStartRef.current = { time, frame };
  }, [shouldRun, animating, time, frame]);

  useEffect(() => {
    if (fadeStartRef.current != null && time - fadeStartRef.current.time >= FADE_OUT_MS) {
      setAnimating(false);
    }
  }, [time]);

  const fadeStart = fadeStartRef.current;
  const peak =
    (fadeStart == null ? frame % cycle : (fadeStart.frame % cycle) + frame - fadeStart.frame) -
    WAVE_WIDTH;
  const fade = fadeStart == null ? 1 : Math.max(0, 1 - (time - fadeStart.time) / FADE_OUT_MS);
  const active = animating && fade > 0;

  return (
    <Span>
      {characters.map(({ char, from, fromRgb, toRgb }, index) => {
        let color = from;
        if (active && fromRgb != null && toRgb != null) {
          const distance = Math.abs(peak - index);
          const highlight =
            distance >= WAVE_WIDTH ? 0 : (1 + Math.cos((distance / WAVE_WIDTH) * Math.PI)) / 2;
          color = mix(fromRgb, toRgb, highlight * fade);
        }
        return (
          <Span key={index} style={{ color }}>
            {char}
          </Span>
        );
      })}
    </Span>
  );
}

export default React.memo(Shimmer);
