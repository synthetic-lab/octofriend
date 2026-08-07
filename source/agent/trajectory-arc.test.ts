import { describe, expect, it } from "vitest";
import { retryIntervalForAttempt } from "./trajectory-arc.ts";

describe("retryIntervalForAttempt", () => {
  it("uses a fixed 5s interval for the first two retries", () => {
    expect(retryIntervalForAttempt(1)).toBe(5_000);
    expect(retryIntervalForAttempt(2)).toBe(5_000);
  });

  it("doubles the interval for subsequent retries", () => {
    expect(retryIntervalForAttempt(3)).toBe(10_000);
    expect(retryIntervalForAttempt(4)).toBe(20_000);
    expect(retryIntervalForAttempt(5)).toBe(40_000);
  });

  it("caps the interval at 10 minutes", () => {
    expect(retryIntervalForAttempt(8)).toBe(320_000);
    expect(retryIntervalForAttempt(9)).toBe(600_000);
    expect(retryIntervalForAttempt(20)).toBe(600_000);
  });
});
