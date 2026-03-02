import { describe, it, expect } from "vitest";
import { formatTimeUntil } from "./time.ts";

describe("formatTimeUntil", () => {
  const now = new Date("2026-03-02T12:00:00Z");

  it("should format minutes only (singular)", () => {
    const expiresAt = new Date("2026-03-02T12:01:00Z");
    expect(formatTimeUntil(expiresAt, now)).toBe("in 1 minute");
  });

  it("should format minutes only (plural)", () => {
    const expiresAt = new Date("2026-03-02T12:30:00Z");
    expect(formatTimeUntil(expiresAt, now)).toBe("in 30 minutes");
  });

  it("should format hours only (singular)", () => {
    const expiresAt = new Date("2026-03-02T13:00:00Z");
    expect(formatTimeUntil(expiresAt, now)).toBe("in 1 hour");
  });

  it("should format hours only (plural)", () => {
    const expiresAt = new Date("2026-03-02T15:00:00Z");
    expect(formatTimeUntil(expiresAt, now)).toBe("in 3 hours");
  });

  it("should format hours and minutes", () => {
    const expiresAt = new Date("2026-03-02T13:45:00Z");
    expect(formatTimeUntil(expiresAt, now)).toBe("in 1 hour 45 minutes");
  });

  it("should format days only (singular)", () => {
    const expiresAt = new Date("2026-03-03T12:00:00Z");
    expect(formatTimeUntil(expiresAt, now)).toBe("in 1 day");
  });

  it("should format days only (plural)", () => {
    const expiresAt = new Date("2026-03-05T12:00:00Z");
    expect(formatTimeUntil(expiresAt, now)).toBe("in 3 days");
  });

  it("should format days and hours", () => {
    const expiresAt = new Date("2026-03-03T18:00:00Z");
    expect(formatTimeUntil(expiresAt, now)).toBe("in 1 day 6 hours");
  });

  it("should handle 59 minutes as minutes", () => {
    const expiresAt = new Date("2026-03-02T12:59:00Z");
    expect(formatTimeUntil(expiresAt, now)).toBe("in 59 minutes");
  });

  it("should handle exactly 60 minutes as 1 hour", () => {
    const expiresAt = new Date("2026-03-02T13:00:00Z");
    expect(formatTimeUntil(expiresAt, now)).toBe("in 1 hour");
  });

  it("should handle 23 hours as hours", () => {
    const expiresAt = new Date("2026-03-03T11:00:00Z");
    expect(formatTimeUntil(expiresAt, now)).toBe("in 23 hours");
  });

  it("should handle exactly 24 hours as 1 day", () => {
    const expiresAt = new Date("2026-03-03T12:00:00Z");
    expect(formatTimeUntil(expiresAt, now)).toBe("in 1 day");
  });

  it("should handle 1 hour 1 minute correctly", () => {
    const expiresAt = new Date("2026-03-02T13:01:00Z");
    expect(formatTimeUntil(expiresAt, now)).toBe("in 1 hour 1 minute");
  });

  it("should handle 1 day 1 hour correctly", () => {
    const expiresAt = new Date("2026-03-03T13:00:00Z");
    expect(formatTimeUntil(expiresAt, now)).toBe("in 1 day 1 hour");
  });

  it("should round up less than 1 minute to 1 minute", () => {
    const expiresAt = new Date("2026-03-02T12:00:30Z");
    expect(formatTimeUntil(expiresAt, now)).toBe("in 1 minute");
  });

  it("should round up 1 second to 1 minute", () => {
    const expiresAt = new Date("2026-03-02T12:00:01Z");
    expect(formatTimeUntil(expiresAt, now)).toBe("in 1 minute");
  });

  it("should handle 0 time difference as 0 minutes", () => {
    const expiresAt = new Date("2026-03-02T12:00:00Z");
    expect(formatTimeUntil(expiresAt, now)).toBe("in 0 minutes");
  });

  it("should handle negative seconds as 0 minutes", () => {
    const expiresAt = new Date("2026-03-02T11:59:30Z");
    expect(formatTimeUntil(expiresAt, now)).toBe("in 0 minutes");
  });

  it("should handle negative minutes as 0 minutes", () => {
    const expiresAt = new Date("2026-03-02T11:55:00Z");
    expect(formatTimeUntil(expiresAt, now)).toBe("in 0 minutes");
  });

  it("should handle negative hours as 0 minutes", () => {
    const expiresAt = new Date("2026-03-02T10:00:00Z");
    expect(formatTimeUntil(expiresAt, now)).toBe("in 0 minutes");
  });

  it("should handle negative days as 0 minutes", () => {
    const expiresAt = new Date("2026-02-28T12:00:00Z");
    expect(formatTimeUntil(expiresAt, now)).toBe("in 0 minutes");
  });
});
