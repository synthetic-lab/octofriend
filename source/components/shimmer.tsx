import React, { useEffect, useRef, useState } from "react";
import { Span, useAnimation } from "paintcannon-react";

type Props = {
  text: string;
  from: string;
  to: string;
  running?: boolean;
};

const INTERVAL_MS = 60;
const WAVE_WIDTH = 4;

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

function Shimmer({ text, from, to, running = false }: Props) {
  const fromRgb = parseHex(from);
  const toRgb = parseHex(to);
  const [animating, setAnimating] = useState(running);
  const stopAtRef = useRef<number | null>(null);
  const { frame } = useAnimation({ isActive: animating, interval: INTERVAL_MS });
  const cycle = text.length + 2 * WAVE_WIDTH;

  useEffect(() => {
    if (running) {
      stopAtRef.current = null;
      setAnimating(true);
      return;
    }
    if (!animating || stopAtRef.current != null) return;
    stopAtRef.current = Math.ceil((frame + 1) / cycle) * cycle;
  }, [running, animating, frame, cycle]);

  useEffect(() => {
    if (stopAtRef.current != null && frame >= stopAtRef.current) {
      setAnimating(false);
    }
  }, [frame]);

  const peak = (frame % cycle) - WAVE_WIDTH;
  const active = animating && (stopAtRef.current == null || frame < stopAtRef.current);

  return (
    <Span>
      {text.split("").map((char, index) => {
        let color = from;
        if (active && fromRgb != null && toRgb != null) {
          const distance = Math.abs(peak - index);
          const highlight =
            distance >= WAVE_WIDTH ? 0 : (1 + Math.cos((distance / WAVE_WIDTH) * Math.PI)) / 2;
          color = mix(fromRgb, toRgb, highlight);
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
