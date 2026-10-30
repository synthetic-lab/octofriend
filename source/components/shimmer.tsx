import React, { useEffect, useRef, useState } from "react";
import { Span, useAnimation } from "paintcannon-react";
import { useShimmerlockOwnershipCheck } from "../hooks/use-shimmerlock.ts";

export type ShimmerSegment = {
  text: string;
  from: string;
  to: string;
};

export type ShimmerEndEvent = {
  holdsShimmerlock: boolean;
};

type Props = {
  segments: Array<ShimmerSegment>;
  lock: symbol;
  running: boolean;
  onShimmerEnd?: (event: ShimmerEndEvent) => void;
};

const INTERVAL_MS = 60;
const WAVE_WIDTH = 4;
const FADE_OUT_MS = 500;

/** Duration of one full shimmer sweep, in milliseconds. */
export function shimmerTime(str: string): number {
  return (str.length + 2 * WAVE_WIDTH) * INTERVAL_MS;
}

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

function Shimmer({ segments, lock, running, onShimmerEnd }: Props) {
  const ownsLock = useShimmerlockOwnershipCheck(lock);
  const shouldRun = running && ownsLock;
  const characters = segments.flatMap(({ text, from, to }) => {
    const fromRgb = parseHex(from);
    const toRgb = parseHex(to);
    return text.split("").map(char => ({ char, from, fromRgb, toRgb }));
  });
  const [animating, setAnimating] = useState(shouldRun);
  const fadeStartRef = useRef<{ time: number; frame: number; position: number } | null>(null);
  const onShimmerEndRef = useRef(onShimmerEnd);
  const lastCycleRef = useRef(0);
  // Keep cycle events ticking even when the lock suppresses the highlight.
  const { frame: animationFrame, time } = useAnimation({
    isActive: running || animating,
    interval: INTERVAL_MS,
  });
  const cycle = characters.length + 2 * WAVE_WIDTH;
  const [cycleStart, setCycleStart] = useState({
    running,
    ownsLock,
    frame: 0,
    length: cycle,
    completed: 0,
  });
  if (cycleStart.running !== running || cycleStart.ownsLock !== ownsLock) {
    // Reset before committing a newly visible frame or firing cycle events.
    const restart = running && (!cycleStart.running || ownsLock);
    setCycleStart({
      running,
      ownsLock,
      frame: restart ? animationFrame : cycleStart.frame,
      length: restart ? cycle : cycleStart.length,
      completed: restart ? 0 : cycleStart.completed,
    });
  } else if (cycle > cycleStart.length) {
    // Extend for longer text; shorter text takes effect after the current sweep finishes.
    setCycleStart({ ...cycleStart, length: cycle });
  } else if (running && animationFrame - cycleStart.frame >= cycleStart.length) {
    const remaining = animationFrame - cycleStart.frame - cycleStart.length;
    setCycleStart({
      ...cycleStart,
      frame: animationFrame - (remaining % cycle),
      length: cycle,
      completed: cycleStart.completed + 1 + Math.floor(remaining / cycle),
    });
  }
  const frame = animationFrame - cycleStart.frame;

  useEffect(() => {
    if (shouldRun) {
      fadeStartRef.current = null;
      setAnimating(true);
      return;
    }
    if (!animating || fadeStartRef.current != null) return;
    fadeStartRef.current = { time, frame: animationFrame, position: frame };
  }, [shouldRun, animating, time, animationFrame, frame]);

  useEffect(() => {
    if (fadeStartRef.current != null && time - fadeStartRef.current.time >= FADE_OUT_MS) {
      setAnimating(false);
    }
  }, [time]);

  useEffect(() => {
    onShimmerEndRef.current = onShimmerEnd;
  }, [onShimmerEnd]);

  useEffect(() => {
    if (!running) {
      lastCycleRef.current = 0;
      return;
    }
    const lastCycle = lastCycleRef.current;
    lastCycleRef.current = cycleStart.completed;
    if (cycleStart.completed > lastCycle) {
      onShimmerEndRef.current?.({ holdsShimmerlock: ownsLock });
    }
  }, [cycleStart.completed, running, ownsLock]);

  const fadeStart = shouldRun ? null : fadeStartRef.current;
  const peak =
    (fadeStart == null ? frame : fadeStart.position + animationFrame - fadeStart.frame) -
    WAVE_WIDTH;
  const fade = fadeStart == null ? 1 : Math.max(0, 1 - (time - fadeStart.time) / FADE_OUT_MS);
  const active = (shouldRun || animating) && fade > 0;

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
