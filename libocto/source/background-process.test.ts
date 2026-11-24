import { unwrap } from "./result.ts";
import { describe, expect, it } from "bun:test";
import { MockTransport, MockTransportProcess } from "libocto/testing";
import { AbortError } from "./transport.ts";
import { BackgroundProcessManager } from "./background-process.ts";

describe("Transport.backgroundShell", () => {
  it("tracks processes from multiple transports in the supplied manager", () => {
    const manager = new BackgroundProcessManager();
    const here = new MockTransport({ cwd: "/here" });
    const there = new MockTransport({ cwd: "/there" });
    const controller = new AbortController();
    const first = unwrap(
      here.backgroundShell({
        command: "pwd",
        label: "here",
        signal: controller.signal,
        backgroundProcessManager: manager,
      }),
    );
    const second = unwrap(
      there.backgroundShell({
        command: "pwd",
        label: "there",
        signal: controller.signal,
        backgroundProcessManager: manager,
      }),
    );
    expect(first.id).not.toBe(second.id);
    expect(manager.list()).toEqual([first, second]);
    expect(here.spawnCalls[0].options).toMatchObject({ cwd: "/here" });
    expect(there.spawnCalls[0].options).toMatchObject({ cwd: "/there" });
    here.spawnCalls[0].process.finish(0, null);
    there.spawnCalls[0].process.finish(0, null);
  });

  it("does not spawn or track a process when already aborted", () => {
    const transport = new MockTransport({});
    const manager = new BackgroundProcessManager();
    const controller = new AbortController();
    controller.abort();
    const result = transport.backgroundShell({
      command: "sleep 30",
      label: "sleeper",
      signal: controller.signal,
      backgroundProcessManager: manager,
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected cancellation");
    expect(result.error).toBeInstanceOf(AbortError);
    expect(transport.spawnCalls).toEqual([]);
    expect(manager.list()).toEqual([]);
  });

  it("keeps a started background process alive when its launching batch is aborted", () => {
    const transport = new MockTransport({});
    const manager = new BackgroundProcessManager();
    const controller = new AbortController();
    const background = unwrap(
      transport.backgroundShell({
        command: "sleep 30",
        label: "sleeper",
        signal: controller.signal,
        backgroundProcessManager: manager,
      }),
    );
    controller.abort();
    expect(background.status).toEqual({ state: "running" });
    transport.spawnCalls[0].process.finish(0, null);
  });
});

describe("BackgroundProcessManager.track", () => {
  it("tracks a supplied process without a transport", () => {
    const process = new MockTransportProcess();
    const manager = new BackgroundProcessManager();
    const background = manager.track(process, "hello", "echo hello");
    process.stdout.write("hello");
    process.finish(0, null);
    expect(manager.poll(background.id)).toBe(background);
    expect(background.drainUnreadOutput()).toEqual({ stdout: "hello", stderr: "" });
    expect(background.status).toEqual({ state: "exited", code: 0, signal: null });
  });
});

describe("BackgroundProcessManager.list", () => {
  it("is empty before any process is started", () => {
    const manager = new BackgroundProcessManager();

    expect(manager.list()).toEqual([]);
  });
});

describe("BackgroundProcessManager unknown ids", () => {
  it("returns null from poll and kill", async () => {
    const manager = new BackgroundProcessManager();

    expect(manager.poll("bg-process-1")).toBeNull();
    expect(await manager.kill("bg-process-1")).toBeNull();
  });
});
