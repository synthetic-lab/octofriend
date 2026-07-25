import { describe, expect, it } from "vitest";
import { excerpt, MAX_PREVIEW_CHARACTERS } from "./preview.ts";

describe("excerpt", () => {
  it("adds an ellipsis to short text", () => {
    expect(excerpt("Fix the migration first.")).toBe("Fix the migration first.…");
  });

  it("prefers a nearby word boundary", () => {
    const sentence = "Fix the migration, then add previews.";
    const text = `${sentence} Generate an LLM summary later after there is more context.`;

    expect(excerpt(text)).toBe("Fix the migration, then add previews. Generate an…");
    expect(excerpt(text)).toHaveLength(MAX_PREVIEW_CHARACTERS);
  });

  it("falls back to the character limit at a word boundary", () => {
    const text = "word ".repeat(30).trim();
    const expected = `${"word ".repeat(10).trim()}…`;

    expect(excerpt(text)).toBe(expected);
    expect(excerpt(text)).toHaveLength(MAX_PREVIEW_CHARACTERS);
  });
});
