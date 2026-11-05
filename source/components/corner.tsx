import React from "react";
import { Span } from "paintcannon-react";
import { useLegacyComputingSymbols } from "../hooks/use-legacy-computing-symbols.ts";

const CORNER_GLYPHS = {
  "top-left": String.fromCodePoint(0x1fb41),
  "top-right": String.fromCodePoint(0x1fb4c),
  "bottom-left": String.fromCodePoint(0x1fb52),
  "bottom-right": String.fromCodePoint(0x1fb5d),
} as const;
const SQUARE_CORNER = String.fromCodePoint(0x2588);

type CornerProps = {
  color: string;
};

type CornerPosition = keyof typeof CORNER_GLYPHS;

function Corner({ position, color }: CornerProps & { position: CornerPosition }) {
  const legacyCorner = useLegacyComputingSymbols();
  return <Span style={{ color }}>{legacyCorner ? CORNER_GLYPHS[position] : SQUARE_CORNER}</Span>;
}

export function TopLeftCorner({ color }: CornerProps) {
  return <Corner position="top-left" color={color} />;
}

export function TopRightCorner({ color }: CornerProps) {
  return <Corner position="top-right" color={color} />;
}

export function BottomLeftCorner({ color }: CornerProps) {
  return <Corner position="bottom-left" color={color} />;
}

export function BottomRightCorner({ color }: CornerProps) {
  return <Corner position="bottom-right" color={color} />;
}
