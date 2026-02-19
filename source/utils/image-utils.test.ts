import { describe, it, expect } from "vitest";
import { separateFilePaths, parseImagePaths } from "./image-utils.ts";

describe("separateFilePaths", () => {
  it("single path with no special spaces", () => {
    expect(separateFilePaths("/path/to/file.png")).toEqual(["/path/to/file.png"]);
  });

  it("two paths delimited by a regular space", () => {
    expect(separateFilePaths("/path/to/a.png /path/to/b.png")).toEqual([
      "/path/to/a.png",
      "/path/to/b.png",
    ]);
  });

  it("single path containing a non-breaking space (\\u00A0)", () => {
    expect(separateFilePaths("/path/to/my\u00A0file.png")).toEqual(["/path/to/my\u00A0file.png"]);
  });

  it("two paths delimited by a regular space where one path has a non-breaking space", () => {
    expect(separateFilePaths("/path/to/my\u00A0file.png /path/to/b.png")).toEqual([
      "/path/to/my\u00A0file.png",
      "/path/to/b.png",
    ]);
  });

  it("two paths both containing non-breaking spaces, delimited by a regular space", () => {
    expect(separateFilePaths("/path/my\u00A0file.png /other/my\u00A0file.png")).toEqual([
      "/path/my\u00A0file.png",
      "/other/my\u00A0file.png",
    ]);
  });

  it("path containing a thin space (\\u2009)", () => {
    expect(separateFilePaths("/path/to/my\u2009file.png /b.png")).toEqual([
      "/path/to/my\u2009file.png",
      "/b.png",
    ]);
  });

  it("path containing a mix of special space characters", () => {
    const input = "/path/my\u00A0weird\u2009file.png /other/normal.png";
    expect(separateFilePaths(input)).toEqual([
      "/path/my\u00A0weird\u2009file.png",
      "/other/normal.png",
    ]);
  });

  it("three paths delimited by regular spaces", () => {
    expect(separateFilePaths("/a.png /b.png /c.png")).toEqual(["/a.png", "/b.png", "/c.png"]);
  });
});

describe("parseImagePaths", () => {
  it("single valid .png path returns array with that path", () => {
    expect(parseImagePaths("/path/to/file.png")).toEqual(["/path/to/file.png"]);
  });

  it("two valid image paths returns both paths", () => {
    expect(parseImagePaths("/a.png /b.jpg")).toEqual(["/a.png", "/b.jpg"]);
  });

  it("supports .jpeg, .webp, and .gif extensions", () => {
    expect(parseImagePaths("/a.jpeg")).toEqual(["/a.jpeg"]);
    expect(parseImagePaths("/a.webp")).toEqual(["/a.webp"]);
    expect(parseImagePaths("/a.gif")).toEqual(["/a.gif"]);
  });

  it("non-image extension returns null", () => {
    expect(parseImagePaths("/path/to/file.txt")).toBeNull();
  });

  it("mix of image and non-image paths returns null", () => {
    expect(parseImagePaths("/a.png /b.txt")).toBeNull();
  });

  // sanitizeFilePath behavior (tested indirectly since it is not exported)

  it("strips surrounding single quotes from path", () => {
    expect(parseImagePaths("'/path/to/file.png'")).toEqual(["/path/to/file.png"]);
  });

  it("strips surrounding double quotes from path", () => {
    expect(parseImagePaths('"/path/to/file.png"')).toEqual(["/path/to/file.png"]);
  });

  it("unescapes a shell-escaped space so the path contains a literal space", () => {
    // Input: /path/to/my\ file.png  (backslash-escaped space, one path)
    expect(parseImagePaths("/path/to/my\\ file.png")).toEqual(["/path/to/my file.png"]);
  });

  it("unescapes shell-escaped special characters like parentheses", () => {
    // Input: /path/to/file\(1\).png  →  /path/to/file(1).png
    expect(parseImagePaths("/path/to/file\\(1\\).png")).toEqual(["/path/to/file(1).png"]);
  });
});
