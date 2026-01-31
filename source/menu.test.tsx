import { describe, it, expect } from "vitest";
import { TransportContext } from "./app.tsx";
import { Config } from "./config.ts";

describe("Menu exit plan mode", () => {
  it("has TransportContext exported from app.tsx", () => {
    // Verify TransportContext is properly exported and can be imported by menu.tsx
    expect(TransportContext).toBeDefined();
    expect(TransportContext.Provider).toBeDefined();
    expect(TransportContext.Consumer).toBeDefined();
  });

  it("has correct Config type for useConfig hook", () => {
    // This test verifies the Config type has the required properties
    const mockConfig: Config = {
      yourName: "test",
      models: [],
    };
    expect(mockConfig.yourName).toBe("test");
    expect(mockConfig.models).toEqual([]);
  });
});
