import { describe, expect, it } from "bun:test";
import { OctoProcessManager } from "./octo-process.ts";
import { BackgroundProcessManager } from "./background-process.ts";

describe("BackgroundProcessManager.start", () => {
  it("runs the command and polls report the exit", async () => {
    const manager = new BackgroundProcessManager(new OctoProcessManager());
    const backgroundProcess = manager.start("echo hello");

    await waitFor(() => manager.poll(backgroundProcess.id)?.status.state === "exited");

    expect(manager.poll(backgroundProcess.id)!.status).toEqual({
      state: "exited",
      code: 0,
      signal: null,
    });
  });

  it("polls drain output incrementally", async () => {
    const manager = new BackgroundProcessManager(new OctoProcessManager());
    const backgroundProcess = manager.start("echo hello");

    let drained = "";
    await waitFor(() => {
      drained += manager.poll(backgroundProcess.id)!.drainUnreadOutput();
      return drained === "hello\n";
    });

    await waitFor(() => manager.poll(backgroundProcess.id)?.status.state === "exited");

    expect(manager.poll(backgroundProcess.id)!.drainUnreadOutput()).toBe("");
    expect(backgroundProcess.outputExceeded).toBe(false);
  });

  it("reports the command the process was started with", async () => {
    const manager = new BackgroundProcessManager(new OctoProcessManager());
    const backgroundProcess = manager.start("echo hello");

    expect(manager.poll(backgroundProcess.id)!.command).toBe("echo hello");

    await waitFor(() => manager.poll(backgroundProcess.id)?.status.state === "exited");
  });
});

describe("BackgroundProcessManager.kill", () => {
  it("terminates a long-running process", async () => {
    const manager = new BackgroundProcessManager(new OctoProcessManager());
    const backgroundProcess = manager.start("sleep 30");
    expect(manager.poll(backgroundProcess.id)!.status).toEqual({ state: "running" });

    expect(manager.kill(backgroundProcess.id)).toBe(backgroundProcess);

    await waitFor(() => manager.poll(backgroundProcess.id)?.status.state === "exited");
  });
});

describe("BackgroundProcess.awaitChange", () => {
  it("waits up to the timeout when nothing changes", async () => {
    const manager = new BackgroundProcessManager(new OctoProcessManager());
    const backgroundProcess = manager.start("sleep 30");

    const start = Date.now();
    await backgroundProcess.awaitActivity(250, new AbortController().signal);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(200);
    expect(backgroundProcess.drainUnreadOutput()).toBe("");

    manager.kill(backgroundProcess.id);
    await waitFor(() => backgroundProcess.status.state === "exited");
  });

  it("unblocks when output arrives", async () => {
    const manager = new BackgroundProcessManager(new OctoProcessManager());
    const backgroundProcess = manager.start("sleep 0.3 && echo late");

    const start = Date.now();
    await backgroundProcess.awaitActivity(10_000, new AbortController().signal);
    const elapsed = Date.now() - start;

    expect(backgroundProcess.drainUnreadOutput()).toContain("late");
    expect(elapsed).toBeLessThan(5_000);

    await waitFor(() => backgroundProcess.status.state === "exited");
  });

  it("unblocks when the process exits", async () => {
    const manager = new BackgroundProcessManager(new OctoProcessManager());
    const backgroundProcess = manager.start("sleep 0.3");

    const start = Date.now();
    await backgroundProcess.awaitActivity(10_000, new AbortController().signal);
    const elapsed = Date.now() - start;

    expect(backgroundProcess.status.state).toBe("exited");
    expect(elapsed).toBeLessThan(5_000);
  });

  it("unblocks on abort", async () => {
    const manager = new BackgroundProcessManager(new OctoProcessManager());
    const backgroundProcess = manager.start("sleep 30");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    const start = Date.now();
    await backgroundProcess.awaitActivity(10_000, controller.signal);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(5_000);

    manager.kill(backgroundProcess.id);
    await waitFor(() => backgroundProcess.status.state === "exited");
  });
});

describe("BackgroundProcessManager.list", () => {
  it("lists started processes with their ids, commands, and statuses", async () => {
    const manager = new BackgroundProcessManager(new OctoProcessManager());
    const first = manager.start("echo hello");
    const second = manager.start("sleep 30");

    await waitFor(() => manager.poll(first.id)?.status.state === "exited");

    expect(manager.list().map(p => ({ id: p.id, command: p.command, status: p.status }))).toEqual([
      { id: first.id, command: "echo hello", status: { state: "exited", code: 0, signal: null } },
      { id: second.id, command: "sleep 30", status: { state: "running" } },
    ]);

    manager.kill(second.id);
    await waitFor(() => manager.poll(second.id)?.status.state === "exited");
  });

  it("is empty before any process is started", () => {
    const manager = new BackgroundProcessManager(new OctoProcessManager());

    expect(manager.list()).toEqual([]);
  });
});

describe("BackgroundProcessManager unknown ids", () => {
  it("returns null from poll and kill", () => {
    const manager = new BackgroundProcessManager(new OctoProcessManager());

    expect(manager.poll("bg-1")).toBeNull();
    expect(manager.kill("bg-1")).toBeNull();
  });
});

async function waitFor(cond: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
