import { describe, it, expect } from "vitest";
import { nextMode, MODES, type ModeType } from "./modes.ts";

describe("nextMode", () => {
  it("returns unchained after collaboration", () => {
    expect(nextMode("collaboration")).toBe("unchained");
  });

  it("returns plan after unchained", () => {
    expect(nextMode("unchained")).toBe("plan");
  });

  it("returns collaboration after plan", () => {
    expect(nextMode("plan")).toBe("collaboration");
  });

  it("cycles back to the starting mode after iterating all modes", () => {
    let mode: ModeType = MODES[0];
    for (let i = 0; i < MODES.length; i++) {
      mode = nextMode(mode);
    }
    expect(mode).toBe(MODES[0]);
  });
});
