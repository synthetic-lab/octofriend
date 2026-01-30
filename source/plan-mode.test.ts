import { describe, it, expect, vi } from "vitest";
import { getPlanFilePath, initializePlanFile } from "./plan-mode.ts";
import type { Transport } from "./transports/transport-common.ts";
import * as logger from "./logger.ts";

const PLAN_TEMPLATE = `# Implementation Plan

## Goal
[Your task description here]

## Exploration
[Agent will fill in findings from codebase analysis]

## Implementation Steps
1. [Step 1]
2. [Step 2]
3. [Step 3]

## Files to Modify
- [file path]: [description of changes]

## Notes
[Any additional notes or considerations]
`;

function createMockTransport(overrides?: Partial<Transport>): Transport {
  return {
    shell: vi.fn(),
    mkdir: vi.fn(),
    pathExists: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
    isDirectory: vi.fn(),
    readdir: vi.fn(),
    modTime: vi.fn(),
    resolvePath: vi.fn(),
    cwd: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}

describe("getPlanFilePath", () => {
  const signal = new AbortController().signal;

  it("uses git branch name with unique ID", async () => {
    const transport = createMockTransport({
      shell: vi.fn().mockResolvedValue("main\n"),
    });

    const result = await getPlanFilePath(transport, signal);

    expect(result).toMatch(/^\.plans\/main-[a-z0-9]{6}\.md$/);
  });

  it("sanitizes special characters in branch names with unique ID", async () => {
    const transport = createMockTransport({
      shell: vi.fn().mockResolvedValue("feature/test_branch@123\n"),
    });

    const result = await getPlanFilePath(transport, signal);

    expect(result).toMatch(/^\.plans\/feature-test_branch-123-[a-z0-9]{6}\.md$/);
  });

  it("falls back to default with unique ID when expected git error occurs", async () => {
    const transport = createMockTransport({
      shell: vi.fn().mockRejectedValue(new Error("fatal: not a git repository")),
    });

    const result = await getPlanFilePath(transport, signal);

    expect(result).toMatch(/^\.plans\/default-[a-z0-9]{6}\.md$/);
  });

  it("re-throws unexpected errors", async () => {
    const transport = createMockTransport({
      shell: vi.fn().mockRejectedValue(new Error("ENOMEM: out of memory")),
    });

    await expect(getPlanFilePath(transport, signal)).rejects.toThrow("ENOMEM: out of memory");
  });

  it("trims whitespace from branch name with unique ID", async () => {
    const transport = createMockTransport({
      shell: vi.fn().mockResolvedValue("  develop  \n"),
    });

    const result = await getPlanFilePath(transport, signal);

    expect(result).toMatch(/^\.plans\/develop-[a-z0-9]{6}\.md$/);
  });

  it("handles empty branch name (edge case) with unique ID", async () => {
    const transport = createMockTransport({
      shell: vi.fn().mockResolvedValue("\n"),
    });

    const result = await getPlanFilePath(transport, signal);

    // Empty branch name results in just the unique ID
    expect(result).toMatch(/^\.plans\/-[a-z0-9]{6}\.md$/);
  });

  it("generates unique IDs for different calls", async () => {
    const transport = createMockTransport({
      shell: vi.fn().mockResolvedValue("main\n"),
    });

    const result1 = await getPlanFilePath(transport, signal);
    const result2 = await getPlanFilePath(transport, signal);

    // Both should match the pattern but be different
    expect(result1).toMatch(/^\.plans\/main-[a-z0-9]{6}\.md$/);
    expect(result2).toMatch(/^\.plans\/main-[a-z0-9]{6}\.md$/);
    expect(result1).not.toBe(result2);
  });

  it("logs error message when expected git error occurs", async () => {
    const logErrorSpy = vi.spyOn(logger, "error");
    const transport = createMockTransport({
      shell: vi.fn().mockRejectedValue(new Error("git: command not found")),
    });

    await getPlanFilePath(transport, signal);

    expect(logErrorSpy).toHaveBeenCalledWith(
      "info",
      "Failed to get current git branch, using default",
      expect.objectContaining({
        error: expect.any(String),
      }),
    );
  });
});

describe("initializePlanFile", () => {
  const signal = new AbortController().signal;

  it("creates directory and writes template for new files", async () => {
    const mkdirMock = vi.fn().mockResolvedValue(undefined);
    const pathExistsMock = vi.fn().mockResolvedValue(false);
    const writeFileMock = vi.fn().mockResolvedValue(undefined);

    const transport = createMockTransport({
      mkdir: mkdirMock,
      pathExists: pathExistsMock,
      writeFile: writeFileMock,
    });

    const filePath = ".plans/main.md";
    await initializePlanFile(transport, filePath, signal);

    expect(mkdirMock).toHaveBeenCalledWith(signal, ".plans");
    expect(pathExistsMock).toHaveBeenCalledWith(signal, filePath);
    expect(writeFileMock).toHaveBeenCalledWith(signal, filePath, PLAN_TEMPLATE);
  });

  it("does not overwrite existing files", async () => {
    const mkdirMock = vi.fn().mockResolvedValue(undefined);
    const pathExistsMock = vi.fn().mockResolvedValue(true);
    const writeFileMock = vi.fn().mockResolvedValue(undefined);

    const transport = createMockTransport({
      mkdir: mkdirMock,
      pathExists: pathExistsMock,
      writeFile: writeFileMock,
    });

    const filePath = ".plans/main.md";
    await initializePlanFile(transport, filePath, signal);

    expect(mkdirMock).toHaveBeenCalled();
    expect(pathExistsMock).toHaveBeenCalledWith(signal, filePath);
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("propagates mkdir errors to caller", async () => {
    const mkdirMock = vi.fn().mockRejectedValue(new Error("EEXIST: directory already exists"));
    const pathExistsMock = vi.fn().mockResolvedValue(false);
    const writeFileMock = vi.fn().mockResolvedValue(undefined);

    const transport = createMockTransport({
      mkdir: mkdirMock,
      pathExists: pathExistsMock,
      writeFile: writeFileMock,
    });

    const filePath = ".plans/main.md";
    await expect(initializePlanFile(transport, filePath, signal)).rejects.toThrow(
      "EEXIST: directory already exists",
    );

    expect(mkdirMock).toHaveBeenCalled();
  });

  it("propagates writeFile errors to caller", async () => {
    const mkdirMock = vi.fn().mockResolvedValue(undefined);
    const pathExistsMock = vi.fn().mockResolvedValue(false);
    const writeFileMock = vi.fn().mockRejectedValue(new Error("Permission denied"));

    const transport = createMockTransport({
      mkdir: mkdirMock,
      pathExists: pathExistsMock,
      writeFile: writeFileMock,
    });

    const filePath = ".plans/main.md";
    await expect(initializePlanFile(transport, filePath, signal)).rejects.toThrow(
      "Permission denied",
    );
  });

  it("uses correct PLAN_DIR for mkdir", async () => {
    const mkdirMock = vi.fn().mockResolvedValue(undefined);
    const pathExistsMock = vi.fn().mockResolvedValue(false);
    const writeFileMock = vi.fn().mockResolvedValue(undefined);

    const transport = createMockTransport({
      mkdir: mkdirMock,
      pathExists: pathExistsMock,
      writeFile: writeFileMock,
    });

    const filePath = ".plans/main.md";
    await initializePlanFile(transport, filePath, signal);

    const mkdirCall = mkdirMock.mock.calls[0];
    expect(mkdirCall[1]).toBe(".plans");
  });
});
