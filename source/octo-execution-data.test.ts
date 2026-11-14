import { describe, expect, it } from "bun:test";
import type { Config } from "./config.ts";
import { isLspGloballyDisabled } from "./lsp/detect.ts";
import { adaptOctoExecutionData, createCachedSearchConfigReader } from "./octo-execution-data.ts";

const config: Config = { yourName: "Test", models: [] };
const firstSearch = { url: "https://first.example/search", key: "first" };
const secondSearch = { url: "https://second.example/search", key: "second" };

describe("cached search config resolution", () => {
  it("reuses the first successful result and coalesces concurrent resolutions", async () => {
    let calls = 0;
    let selected = firstSearch;
    let resolveFirst!: (value: typeof firstSearch) => void;
    const pending = new Promise<typeof firstSearch>(resolve => {
      resolveFirst = resolve;
    });
    const read = createCachedSearchConfigReader(async () => {
      calls++;
      if (calls === 1) return pending;
      return selected;
    });

    const first = read(config);
    const concurrent = read(config);
    await Promise.resolve();
    expect(calls).toBe(1);
    resolveFirst(firstSearch);
    expect(await Promise.all([first, concurrent])).toEqual([firstSearch, firstSearch]);

    selected = secondSearch;
    expect(await read(config)).toBe(firstSearch);
    expect(await read(config)).toBe(firstSearch);
    expect(calls).toBe(1);
  });

  it("retries after a null result before caching a later success", async () => {
    let calls = 0;
    const read = createCachedSearchConfigReader(async () => {
      calls++;
      return calls === 1 ? null : firstSearch;
    });

    expect(await read(config)).toBeNull();
    expect(await read(config)).toEqual(firstSearch);
    expect(await read(config)).toEqual(firstSearch);
    expect(calls).toBe(2);
  });

  it("clears failed resolutions so a later call can retry", async () => {
    let calls = 0;
    const read = createCachedSearchConfigReader(async () => {
      calls++;
      if (calls === 1) throw new Error("auth unavailable");
      return firstSearch;
    });

    await expect(read(config)).rejects.toThrow("auth unavailable");
    expect(await read(config)).toEqual(firstSearch);
    expect(await read(config)).toEqual(firstSearch);
    expect(calls).toBe(2);
  });
});

describe("Octo execution-data adaptation", () => {
  it("adapts absent and globally disabled LSP configuration", () => {
    expect(adaptOctoExecutionData(config, null).lsp).toEqual({ config: {} });
    expect(adaptOctoExecutionData({ ...config, lsp: false }, null).lsp).toEqual({
      disabled: true,
      config: {},
    });
  });

  it("retains custom LSP configuration when enabled and globally disabled", () => {
    const customServers = {
      custom: {
        command: ["custom-lsp"],
        extensions: [".custom"],
        rootCandidates: ["custom.json"],
      },
      unavailable: { disabled: true as const },
    };

    expect(adaptOctoExecutionData({ ...config, lsp: customServers }, null).lsp).toEqual({
      config: customServers,
    });
    const globallyDisabled = { lsp: { disabled: true, config: customServers } };
    expect(isLspGloballyDisabled(globallyDisabled)).toBe(true);
    expect(globallyDisabled.lsp.config).toBe(customServers);
  });

  it("passes through resolved search, skill paths, and MCP server specifications", () => {
    const mcpServers = { local: { command: "local-mcp", args: ["serve"] } };
    const data = adaptOctoExecutionData(
      {
        ...config,
        skills: { paths: ["/skills"] },
        mcpServers,
      },
      secondSearch,
    );

    expect(data.searchConfig).toBe(secondSearch);
    expect(data.skillPaths).toEqual(["/skills"]);
    expect(data.mcpServers).toBe(mcpServers);
  });
});
