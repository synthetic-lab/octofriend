import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { FileRenderer } from "./file-renderer.tsx";

describe("FileRenderer", () => {
  it("renders content starting from line 1 by default", () => {
    const { lastFrame } = render(
      <FileRenderer
        contents="function example() {\n  return 'hello';\n}"
        filePath="/test/example.js"
      />,
    );

    const output = lastFrame() || "";
    expect(output).toContain("function example() {");
    expect(output).toContain("return 'hello'");
    expect(output).toContain("1");
  });

  it("uses startLineNr when provided", () => {
    const { lastFrame } = render(
      <FileRenderer contents="appended line" filePath="/test.txt" startLineNr={10} />,
    );

    const output = lastFrame() || "";
    expect(output).toContain("10");
    expect(output).toContain("appended line");
  });

  it("renders multiple lines starting from provided line number", () => {
    const { lastFrame } = render(
      <FileRenderer contents="line 1\nline 2\nline 3" filePath="/test.txt" startLineNr={5} />,
    );

    const output = lastFrame() || "";
    // Should render all content starting from line 5
    expect(output).toContain("line 1");
    expect(output).toContain("line 2");
    expect(output).toContain("line 3");
    expect(output).toContain("5");
  });
});
