import { expect, it } from "bun:test";
import { defineLower } from "./define-lower.ts";
import type { IRConversion } from "./llm-ir.ts";

it("returns the original function without executing or wrapping it", () => {
  type Input = { role: "note"; text: string };
  type Output = { role: "rendered-note"; text: string };
  let calls = 0;
  const convert = (messages: Input[], suffix: string): Array<IRConversion<Input, Output>> => {
    calls++;
    return messages.map(original => ({
      original,
      converted: { role: "rendered-note", text: original.text + suffix },
    }));
  };

  const lower = defineLower(convert);
  expect(lower).toBe(convert);
  expect(calls).toBe(0);

  const original: Input = { role: "note", text: "hi" };
  expect(lower([original], "!")).toEqual([
    { original, converted: { role: "rendered-note", text: "hi!" } },
  ]);
  expect(calls).toBe(1);
});
