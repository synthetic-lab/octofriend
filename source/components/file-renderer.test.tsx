import React from "react";
import { describe, it, expect } from "vitest";
import { renderPaintcannon } from "../test-utils/render-paintcannon.tsx";
import { FileRenderer } from "./file-renderer.tsx";

describe("FileRenderer", () => {
  it("renders content starting from line 1 by default", () => {
    const { text: output } = renderPaintcannon(
      <FileRenderer
        contents="function example() {\n  return 'hello';\n}"
        filePath="/test/example.js"
      />,
    );

    expect(output).toContain("function example() {");
    expect(output).toContain("return 'hello'");
    expect(output).toContain("1");
  });

  it("uses startLineNr when provided", () => {
    const { text: output } = renderPaintcannon(
      <FileRenderer contents="appended line" filePath="/test.txt" startLineNr={10} />,
    );

    expect(output).toContain("10");
    expect(output).toContain("appended line");
  });

  it("renders multiple lines starting from provided line number", () => {
    const { text: output } = renderPaintcannon(
      <FileRenderer contents="line 1\nline 2\nline 3" filePath="/test.txt" startLineNr={5} />,
    );

    // Should render all content starting from line 5
    expect(output).toContain("line 1");
    expect(output).toContain("line 2");
    expect(output).toContain("line 3");
    expect(output).toContain("5");
  });
});
