import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
    cwd: vi.fn().mockResolvedValue("/home/user/my-project"),
    close: vi.fn(),
    ...overrides,
  };
}

describe("getPlanFilePath", () => {
  const logSpy = vi.spyOn(logger, "log");
  const errorSpy = vi.spyOn(logger, "error");

  beforeEach(() => {
    logSpy.mockClear();
    errorSpy.mockClear();
  });

  it("uses git branch name with unique ID", async () => {
    const transport = createMockTransport({
      shell: vi.fn().mockResolvedValue("main\n"),
    });

    const result = await getPlanFilePath(transport, new AbortController().signal);

    expect(result).toMatch(/^\.plans\/main-[a-z0-9]{6}\.md$/);
  });

  it("sanitizes special characters in branch names with unique ID", async () => {
    const transport = createMockTransport({
      shell: vi.fn().mockResolvedValue("feature/test_branch@123\n"),
    });

    const result = await getPlanFilePath(transport, new AbortController().signal);

    expect(result).toMatch(/^\.plans\/feature-test_branch-123-[a-z0-9]{6}\.md$/);
  });

  it("falls back to directory name with unique ID when expected git error occurs", async () => {
    const transport = createMockTransport({
      shell: vi.fn().mockRejectedValue(new Error("fatal: not a git repository")),
    });

    const result = await getPlanFilePath(transport, new AbortController().signal);

    expect(result).toMatch(/^\.plans\/my-project-[a-z0-9]{6}\.md$/);
  });

  it("re-throws unexpected errors", async () => {
    const transport = createMockTransport({
      shell: vi.fn().mockRejectedValue(new Error("ENOMEM: out of memory")),
    });

    await expect(getPlanFilePath(transport, new AbortController().signal)).rejects.toThrow(
      "ENOMEM: out of memory",
    );
  });

  it("trims whitespace from branch name with unique ID", async () => {
    const transport = createMockTransport({
      shell: vi.fn().mockResolvedValue("  develop  \n"),
    });

    const result = await getPlanFilePath(transport, new AbortController().signal);

    expect(result).toMatch(/^\.plans\/develop-[a-z0-9]{6}\.md$/);
  });

  it("handles empty branch name (edge case) with unique ID", async () => {
    const transport = createMockTransport({
      shell: vi.fn().mockResolvedValue("\n"),
      cwd: vi.fn().mockResolvedValue("/path/to/my-project"),
    });

    const result = await getPlanFilePath(transport, new AbortController().signal);

    // Empty branch name falls back to directory name
    expect(result).toMatch(/^\.plans\/my-project-[a-z0-9]{6}\.md$/);
  });

  it("generates unique IDs for different calls", async () => {
    const transport = createMockTransport({
      shell: vi.fn().mockResolvedValue("main\n"),
    });

    const result1 = await getPlanFilePath(transport, new AbortController().signal);
    const result2 = await getPlanFilePath(transport, new AbortController().signal);

    // Both should match the pattern but be different
    expect(result1).toMatch(/^\.plans\/main-[a-z0-9]{6}\.md$/);
    expect(result2).toMatch(/^\.plans\/main-[a-z0-9]{6}\.md$/);
    expect(result1).not.toBe(result2);
  });

  it("handles signal being aborted during shell command", async () => {
    const controller = new AbortController();
    const shellMock = vi.fn().mockRejectedValue(new Error("Aborted"));

    const transport = createMockTransport({
      shell: shellMock,
    });

    await expect(getPlanFilePath(transport, controller.signal)).rejects.toThrow("Aborted");

    expect(shellMock).toHaveBeenCalledWith(controller.signal, "git branch --show-current", 5000);
  });
});

describe("initializePlanFile", () => {
  const logSpy = vi.spyOn(logger, "log");
  const errorSpy = vi.spyOn(logger, "error");

  beforeEach(() => {
    logSpy.mockClear();
    errorSpy.mockClear();
  });

  it("creates directory and writes template for new files", async () => {
    const signal = new AbortController().signal;
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
    const signal = new AbortController().signal;
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
    const signal = new AbortController().signal;
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
      "Failed to create plans directory (.plans): EEXIST: directory already exists",
    );

    expect(mkdirMock).toHaveBeenCalled();
  });

  it("propagates writeFile errors to caller", async () => {
    const signal = new AbortController().signal;
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
      "Failed to create plan file template",
    );

    expect(mkdirMock).toHaveBeenCalled();
    expect(pathExistsMock).toHaveBeenCalled();
    expect(writeFileMock).toHaveBeenCalled();
  });

  it("uses correct PLAN_DIR for mkdir", async () => {
    const signal = new AbortController().signal;
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

  it("handles pathExists throwing an error", async () => {
    const signal = new AbortController().signal;
    const mkdirMock = vi.fn().mockResolvedValue(undefined);
    const pathExistsMock = vi.fn().mockRejectedValue(new Error("EACCES: permission denied"));
    const writeFileMock = vi.fn().mockResolvedValue(undefined);

    const transport = createMockTransport({
      mkdir: mkdirMock,
      pathExists: pathExistsMock,
      writeFile: writeFileMock,
    });

    const filePath = ".plans/main.md";
    await expect(initializePlanFile(transport, filePath, signal)).rejects.toThrow(
      "Failed to check if plan file exists",
    );

    expect(mkdirMock).toHaveBeenCalled();
    expect(pathExistsMock).toHaveBeenCalledWith(signal, filePath);
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("handles signal being aborted during mkdir", async () => {
    const controller = new AbortController();
    const mkdirMock = vi.fn().mockRejectedValue(new Error("Aborted"));
    const pathExistsMock = vi.fn().mockResolvedValue(false);
    const writeFileMock = vi.fn().mockResolvedValue(undefined);

    const transport = createMockTransport({
      mkdir: mkdirMock,
      pathExists: pathExistsMock,
      writeFile: writeFileMock,
    });

    const filePath = ".plans/main.md";
    await expect(initializePlanFile(transport, filePath, controller.signal)).rejects.toThrow(
      "Failed to create plans directory",
    );

    expect(mkdirMock).toHaveBeenCalledWith(controller.signal, ".plans");
    expect(pathExistsMock).not.toHaveBeenCalled();
  });

  it("handles signal being aborted after mkdir succeeds", async () => {
    const controller = new AbortController();
    const mkdirMock = vi.fn().mockResolvedValue(undefined);
    const pathExistsMock = vi.fn().mockRejectedValue(new Error("Aborted"));
    const writeFileMock = vi.fn().mockResolvedValue(undefined);

    const transport = createMockTransport({
      mkdir: mkdirMock,
      pathExists: pathExistsMock,
      writeFile: writeFileMock,
    });

    const filePath = ".plans/main.md";
    await expect(initializePlanFile(transport, filePath, controller.signal)).rejects.toThrow(
      "Failed to check if plan file exists",
    );

    expect(mkdirMock).toHaveBeenCalled();
    expect(pathExistsMock).toHaveBeenCalledWith(controller.signal, filePath);
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("handles signal being aborted during writeFile", async () => {
    const controller = new AbortController();
    const mkdirMock = vi.fn().mockResolvedValue(undefined);
    const pathExistsMock = vi.fn().mockResolvedValue(false);
    const writeFileMock = vi.fn().mockRejectedValue(new Error("Aborted"));

    const transport = createMockTransport({
      mkdir: mkdirMock,
      pathExists: pathExistsMock,
      writeFile: writeFileMock,
    });

    const filePath = ".plans/main.md";
    await expect(initializePlanFile(transport, filePath, controller.signal)).rejects.toThrow(
      "Failed to create plan file template",
    );

    expect(mkdirMock).toHaveBeenCalled();
    expect(pathExistsMock).toHaveBeenCalledWith(controller.signal, filePath);
    expect(writeFileMock).toHaveBeenCalledWith(controller.signal, filePath, PLAN_TEMPLATE);
  });
});

describe("lazy plan file initialization", () => {
  const logSpy = vi.spyOn(logger, "log");
  const errorSpy = vi.spyOn(logger, "error");

  beforeEach(() => {
    logSpy.mockClear();
    errorSpy.mockClear();
  });

  it("does not create plan file when only determining path", async () => {
    // This test simulates the behavior in app.tsx where getPlanFilePath
    // is called but initializePlanFile is not
    const signal = new AbortController().signal;
    const mkdirMock = vi.fn().mockResolvedValue(undefined);
    const pathExistsMock = vi.fn().mockResolvedValue(false);
    const writeFileMock = vi.fn().mockResolvedValue(undefined);

    const transport = createMockTransport({
      shell: vi.fn().mockResolvedValue("main\n"),
      mkdir: mkdirMock,
      pathExists: pathExistsMock,
      writeFile: writeFileMock,
    });

    // Only get the path (simulating app.tsx useEffect)
    const path = await getPlanFilePath(transport, signal);

    // Verify path is returned but no file operations occurred
    expect(path).toMatch(/^\.plans\/main-[a-z0-9]{6}\.md$/);
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(pathExistsMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("creates plan file only when initializePlanFile is called", async () => {
    const signal = new AbortController().signal;
    const mkdirMock = vi.fn().mockResolvedValue(undefined);
    const pathExistsMock = vi.fn().mockResolvedValue(false);
    const writeFileMock = vi.fn().mockResolvedValue(undefined);

    const transport = createMockTransport({
      shell: vi.fn().mockResolvedValue("main\n"),
      mkdir: mkdirMock,
      pathExists: pathExistsMock,
      writeFile: writeFileMock,
    });

    // First get the path (simulating app.tsx useEffect)
    const filePath = await getPlanFilePath(transport, signal);

    // Then initialize (simulating _runAgent lazy initialization)
    await initializePlanFile(transport, filePath, signal);

    // Now file operations should have occurred
    expect(mkdirMock).toHaveBeenCalledWith(signal, ".plans");
    expect(pathExistsMock).toHaveBeenCalledWith(signal, filePath);
    expect(writeFileMock).toHaveBeenCalledWith(signal, filePath, PLAN_TEMPLATE);
  });

  it("handles mode switching without creating files", async () => {
    // Simulates user switching between modes without sending messages
    const signal = new AbortController().signal;
    const mkdirMock = vi.fn().mockResolvedValue(undefined);
    const pathExistsMock = vi.fn().mockResolvedValue(false);
    const writeFileMock = vi.fn().mockResolvedValue(undefined);

    const transport = createMockTransport({
      shell: vi.fn().mockResolvedValue("main\n"),
      mkdir: mkdirMock,
      pathExists: pathExistsMock,
      writeFile: writeFileMock,
    });

    // Simulate multiple mode switches (getting path each time)
    const path1 = await getPlanFilePath(transport, signal);
    const path2 = await getPlanFilePath(transport, signal);
    const path3 = await getPlanFilePath(transport, signal);

    // All paths should be different (unique IDs)
    expect(path1).not.toBe(path2);
    expect(path2).not.toBe(path3);

    // No file operations should have occurred
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(pathExistsMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });
});
