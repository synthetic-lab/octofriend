import React from "react";
import { describe, it, expect } from "bun:test";
import { renderPaintcannon } from "../test-utils/render-paintcannon.tsx";
import { DiffRenderer } from "./diff-renderer.tsx";

describe("DiffRenderer", () => {
  it("renders diff when it can find oldText in file content", () => {
    // The diff function uses oldText to find where the changes start
    const oldText = "line 1\nline 2\nline 3\n";

    const { text: output } = renderPaintcannon(
      <DiffRenderer
        oldText={oldText}
        newText="line 1\nmodified line\nline 3\n"
        filepath="/test.txt"
        fileContents={oldText}
      />,
    );

    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain("Old");
    expect(output).toContain("New");
  });

  it("returns empty when search string not in file content", () => {
    // This can happen if the file has been modified since the tool ran
    const fileText = "line 1\nline 2\nline 3\n";

    const oldText = "line 2\nline 2\n"; // Doesn't match the file content

    const { text: output } = renderPaintcannon(
      <DiffRenderer
        oldText={oldText}
        newText="line 1\nline 2\nline 3\n"
        filepath="/test.txt"
        fileContents={fileText}
      />,
    );

    expect(output).toBe("");
  });
});
