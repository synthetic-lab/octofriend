import { describe, expect, it } from "vitest";
import { err, flatten, ok } from "./result.ts";

describe("flatten", () => {
  it("leaves a flat ok alone", () => {
    const result = flatten(ok(1));

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(1);
  });

  it("flattens nested ok results", () => {
    const result = flatten(ok(ok(ok(1))));

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(1);
  });

  it("flattens nested ok results through the method form", () => {
    const result = ok(ok(ok(1))).flatten();

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(1);
  });

  it("returns the first inner error reached through ok values", () => {
    const result = flatten(ok(ok(err("inner"))));

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("inner");
  });

  it("returns an outer error without inspecting further", () => {
    const result = flatten(err("outer"));

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("outer");
  });

  it("does not flatten non-result ok data", () => {
    const payload = { success: true, data: "not a Result instance" };
    const result = flatten(ok(payload));

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(payload);
  });
});
