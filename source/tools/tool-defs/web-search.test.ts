import { describe, expect, it } from "bun:test";
import { MockTransport } from "../../transports/mock.ts";
import webSearchTool from "./web-search.ts";
import webResearchTool from "./web-research.ts";

function args(searchConfig: { url: string; key: string } | null) {
  return {
    signal: new AbortController().signal,
    transport: new MockTransport({}),
    model: { contextWindow: 100_000 },
    data: { searchConfig },
  };
}

describe("web tool search data", () => {
  it("disables both tools when resolved search configuration is null", async () => {
    expect(await webSearchTool(args(null))).toBeNull();
    expect(await webResearchTool(args(null))).toBeNull();
  });

  it("enables both tools from directly resolved search configuration", async () => {
    const searchConfig = { url: "https://search.example", key: "secret" };
    expect(await webSearchTool(args(searchConfig))).not.toBeNull();
    expect(await webResearchTool(args(searchConfig))).not.toBeNull();
  });
});
