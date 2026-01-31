import { describe, it, expect, vi } from "vitest";
import { systemPrompt } from "./system-prompt.ts";
import { Config } from "../config.ts";
import { Transport } from "../transports/transport-common.ts";
import { PlanModeConfig } from "../modes.ts";

function createMockTransport(): Transport {
  return {
    shell: vi.fn().mockResolvedValue("/test/project"),
    mkdir: vi.fn().mockResolvedValue(undefined),
    pathExists: vi.fn().mockResolvedValue(false),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(""),
    isDirectory: vi.fn().mockResolvedValue(false),
    readdir: vi.fn().mockResolvedValue([]),
    modTime: vi.fn().mockResolvedValue(Date.now()),
    resolvePath: vi.fn().mockResolvedValue("/test/path"),
    cwd: vi.fn().mockResolvedValue("/test"),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as Transport;
}

function createMockConfig(): Config {
  return {
    yourName: "TestUser",
    models: [],
  } as Config;
}

describe("systemPrompt", () => {
  it("includes plan mode section when planModeConfig.isPlanMode is true", async () => {
    const transport = createMockTransport();
    const config = createMockConfig();
    const planModeConfig: PlanModeConfig = {
      isPlanMode: true,
      planFilePath: "/plans/test.md",
    };

    const result = await systemPrompt({
      config,
      transport,
      signal: new AbortController().signal,
      tools: {},
      planModeConfig,
    });

    expect(result).toContain("# Plan Mode");
    expect(result).toContain("plan mode");
    expect(result).toContain("/plans/test.md");
  });

  it("excludes plan mode section when planModeConfig.isPlanMode is false", async () => {
    const transport = createMockTransport();
    const config = createMockConfig();
    const planModeConfig: PlanModeConfig = { isPlanMode: false };

    const result = await systemPrompt({
      config,
      transport,
      signal: new AbortController().signal,
      tools: {},
      planModeConfig,
    });

    expect(result).not.toContain("# Plan Mode");
  });

  it("excludes plan mode section when planModeConfig is undefined", async () => {
    const transport = createMockTransport();
    const config = createMockConfig();

    const result = await systemPrompt({
      config,
      transport,
      signal: new AbortController().signal,
      tools: {},
    });

    expect(result).not.toContain("# Plan Mode");
  });

  it("shows fallback message when planFilePath is null", async () => {
    const transport = createMockTransport();
    const config = createMockConfig();
    const planModeConfig: PlanModeConfig = {
      isPlanMode: true,
      planFilePath: null,
    };

    const result = await systemPrompt({
      config,
      transport,
      signal: new AbortController().signal,
      tools: {},
      planModeConfig,
    });

    expect(result).toContain("# Plan Mode");
    expect(result).toContain("plan file path unavailable");
  });
});
