import { describe, expect, it } from "vitest";
import { excerpt, MAX_PREVIEW_CHARACTERS } from "./str.ts";

describe("excerpt", () => {
  it("omits the ellipsis when the text fits", () => {
    expect(excerpt("Fix the migration first.")).toBe("Fix the migration first.");
  });

  it("only adds an ellipsis when it truncates", () => {
    const fits = "a".repeat(MAX_PREVIEW_CHARACTERS);
    expect(excerpt(fits)).toBe(fits);

    const tooLong = "a".repeat(MAX_PREVIEW_CHARACTERS + 1);
    const result = excerpt(tooLong);
    expect(result.endsWith("…")).toBe(true);
    expect(result).toHaveLength(MAX_PREVIEW_CHARACTERS);
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
