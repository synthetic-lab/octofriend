import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { DiffRenderer } from "./diff-renderer.tsx";
import { readFileSync } from "fs";

vi.mock("fs", () => ({
  readFileSync: vi.fn(),
}));

describe("DiffRenderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders diff when it can find oldText in file content", () => {
    // The diff function uses oldText to find where the changes start
    const oldText = "line 1\nline 2\nline 3\n";
    vi.mocked(readFileSync).mockReturnValue(oldText);

    const { lastFrame } = render(
      <DiffRenderer
        oldText={oldText}
        newText="line 1\nmodified line\nline 3\n"
        filepath="/test.txt"
        fileContents={oldText}
      />,
    );

    const output = lastFrame() || "";
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain("Old");
    expect(output).toContain("New");
  });

  it("returns empty when search string not in file content", () => {
    // This can happen if the file has been modified since the tool ran
    const fileText = "line 1\nline 2\nline 3\n";

    const oldText = "line 2\nline 2\n"; // Doesn't match the file content

    const { lastFrame } = render(
      <DiffRenderer
        oldText={oldText}
        newText="line 1\nline 2\nline 3\n"
        filepath="/test.txt"
        fileContents={fileText}
      />,
    );

    expect(lastFrame()).toBe("");
  });
});
