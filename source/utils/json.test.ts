import { describe, it, expect } from "vitest";
import { recursivelyDecodeStrings } from "./json.ts";

describe("recursivelyDecodeStrings", () => {
  it("should decode a double-encoded JSON string", () => {
    const input = '{"filePath":"test.ts","line":42}';
    const result = recursivelyDecodeStrings(input);
    expect(result).toEqual({ filePath: "test.ts", line: 42 });
  });

  it("should decode calculator tool arguments", () => {
    const input = '{"tool": "calculator", "args": {"x": 10, "y": 20}}';
    const result = recursivelyDecodeStrings(input);
    expect(result).toEqual({ tool: "calculator", args: { x: 10, y: 20 } });
  });

  it("should recursively decode nested double-encoded strings", () => {
    const input = '"{\\"filePath\\":\\"test.ts\\"}"';
    const result = recursivelyDecodeStrings(input);
    expect(result).toEqual({ filePath: "test.ts" });
  });

  it("should decode strings in object values", () => {
    const input = {
      nested: '{"key":"value"}',
      normal: "not-json",
    };
    const result = recursivelyDecodeStrings(input);
    expect(result).toEqual({
      nested: { key: "value" },
      normal: "not-json",
    });
  });
});
