import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { FileRenderer } from "./file-renderer.tsx";
import { readFileSync } from "fs";

vi.mock("fs", () => ({
  readFileSync: vi.fn(),
}));

describe("FileRenderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("operation=create", () => {
    it("renders content starting from line 1 without reading file", () => {
      const { lastFrame } = render(
        <FileRenderer
          contents="function example() {\n  return 'hello';\n}"
          filePath="/test/example.js"
          operation="create"
        />,
      );

      const output = lastFrame() || "";
      expect(output).toContain("function example() {");
      expect(output).toContain("return 'hello'");
      expect(output).toContain("1");
      expect(readFileSync).not.toHaveBeenCalled();
    });
  });

  describe("operation=append", () => {
    it("reads existing file and calculates line numbers", () => {
      vi.mocked(readFileSync).mockReturnValue("existing line 1\nexisting line 2\n");

      const { lastFrame } = render(
        <FileRenderer contents="appended line" filePath="/test.txt" operation="append" />,
      );

      expect(readFileSync).toHaveBeenCalledWith("/test.txt", "utf8");
      const output = lastFrame() || "";
      expect(output).toContain("4");
      expect(output).toContain("appended line");
    });

    it("returns empty when file does not exist", () => {
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error("ENOENT: no such file or directory");
      });

      const { lastFrame } = render(
        <FileRenderer contents="new content" filePath="/nonexistent.txt" operation="append" />,
      );

      expect(lastFrame()).toBe("");
    });
  });

  describe("no operation specified", () => {
    it("renders content without reading file", () => {
      const { lastFrame } = render(<FileRenderer contents="some content" filePath="/test.txt" />);

      expect(readFileSync).not.toHaveBeenCalled();
      const output = lastFrame() || "";
      expect(output).toContain("some content");
    });

    it("uses startLineNr when provided", () => {
      const { lastFrame } = render(
        <FileRenderer contents="content" filePath="/test.txt" startLineNr={10} />,
      );

      const output = lastFrame() || "";
      expect(output).toContain("10");
    });
  });
});
