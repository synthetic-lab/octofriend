import { describe, expect, it } from "bun:test";
import {
  MAX_COMMAND_FAILURE_OUTPUT_LENGTH,
  ShellOutput,
  createPollingFileWatcher,
  truncateCommandFailureOutput,
} from "./transport.ts";
import { MockTransport } from "libocto/testing";

async function waitForCondition(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("Condition not met in time");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

describe("ShellOutput", () => {
  it("preserves output that fits within the limit", () => {
    const output = new ShellOutput(10);
    expect(output.append("01234")).toBe(true);
    expect(output.append(Buffer.from("56789"))).toBe(true);

    expect(output.getOutput()).toBe("0123456789");
  });

  it("rejects output that exceeds the limit instead of returning partial data", () => {
    const output = new ShellOutput(10);
    expect(output.append("0123456789")).toBe(true);
    expect(output.append("a")).toBe(false);

    expect(output.getOutput()).toBeNull();
  });

  it("continues rejecting chunks after the limit is exceeded", () => {
    const output = new ShellOutput(4);
    expect(output.append("abcde")).toBe(false);
    expect(output.append("x")).toBe(false);

    expect(output.getOutput()).toBeNull();
  });

  it("rejects invalid limits", () => {
    expect(() => new ShellOutput(0)).toThrow(RangeError);
    expect(() => new ShellOutput(Number.MAX_VALUE)).toThrow(RangeError);
  });

  it("drains only output appended since the last drain", () => {
    const output = new ShellOutput(100);
    expect(output.hasUndrainedOutput()).toBe(false);
    expect(output.drainNewOutput()).toBe("");

    output.append("hello");
    output.append(" world");
    expect(output.hasUndrainedOutput()).toBe(true);
    expect(output.drainNewOutput()).toBe("hello world");

    expect(output.hasUndrainedOutput()).toBe(false);
    expect(output.drainNewOutput()).toBe("");

    output.append("again");
    expect(output.hasUndrainedOutput()).toBe(true);
    expect(output.drainNewOutput()).toBe("again");
    expect(output.getOutput()).toBe("hello worldagain");
  });

  it("reports no unread output and drains to empty once the limit is exceeded", () => {
    const output = new ShellOutput(5);
    output.append("abcd");
    expect(output.append("ef")).toBe(false);

    expect(output.hasUndrainedOutput()).toBe(false);
    expect(output.drainNewOutput()).toBe("");
  });
});

describe("truncateCommandFailureOutput", () => {
  it("leaves output at or below the failure cap untouched", () => {
    const exact = "a".repeat(MAX_COMMAND_FAILURE_OUTPUT_LENGTH);
    expect(truncateCommandFailureOutput(exact)).toBe(exact);
    expect(truncateCommandFailureOutput("small output")).toBe("small output");
  });

  it("caps oversized output at the failure limit and reports the truncated size", () => {
    const oversized = "a".repeat(MAX_COMMAND_FAILURE_OUTPUT_LENGTH + 12345);
    const result = truncateCommandFailureOutput(oversized);

    expect(result.startsWith("a".repeat(MAX_COMMAND_FAILURE_OUTPUT_LENGTH))).toBe(true);
    expect(result.endsWith("[...truncated 12345 characters]")).toBe(true);
    expect(result.length).toBe(
      MAX_COMMAND_FAILURE_OUTPUT_LENGTH + "\n[...truncated 12345 characters]".length,
    );
  });
});

describe("createPollingFileWatcher", () => {
  it("fires when the watched file is created", async () => {
    const signal = new AbortController().signal;
    const transport = new MockTransport({ cwd: "/repo" });
    const events: string[] = [];
    const watcher = createPollingFileWatcher(
      transport,
      signal,
      "/repo/created.txt",
      () => events.push("event"),
      10,
    );
    // Baseline poll for a file that doesn't exist yet must not fire spuriously.
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(events).toEqual([]);

    await transport.writeFile(signal, "/repo/created.txt", "hi");
    await waitForCondition(() => events.length > 0);
    await watcher.close();
    expect(events).toHaveLength(1);
  });

  it("fires when the watched file's mtime changes", async () => {
    const signal = new AbortController().signal;
    const transport = new MockTransport({
      cwd: "/repo",
      files: { "/repo/changed.txt": "before" },
    });
    const events: string[] = [];
    const watcher = createPollingFileWatcher(
      transport,
      signal,
      "/repo/changed.txt",
      () => events.push("event"),
      10,
    );
    // Baseline poll must not fire for a file that was already present.
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(events).toEqual([]);

    await transport.writeFile(signal, "/repo/changed.txt", "after");
    await waitForCondition(() => events.length > 0);
    await watcher.close();
    expect(events).toHaveLength(1);
  });

  it("does not fire after close()", async () => {
    const signal = new AbortController().signal;
    const transport = new MockTransport({
      cwd: "/repo",
      files: { "/repo/closed.txt": "before" },
    });
    const events: string[] = [];
    const watcher = createPollingFileWatcher(
      transport,
      signal,
      "/repo/closed.txt",
      () => events.push("event"),
      10,
    );
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(events).toEqual([]);

    await watcher.close();
    await transport.writeFile(signal, "/repo/closed.txt", "after");
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(events).toEqual([]);
  });
});
