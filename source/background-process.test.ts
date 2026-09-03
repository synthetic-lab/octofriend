import { describe, expect, it } from "bun:test";
import { OctoProcessManager } from "./octo-process.ts";
import { BackgroundProcessManager } from "./background-process.ts";

describe("BackgroundProcessManager.start", () => {
  it("runs the command and polls report the exit", async () => {
    const manager = new BackgroundProcessManager(new OctoProcessManager());
    const backgroundProcess = manager.start("echo hello", "hello");

    await waitFor(() => manager.poll(backgroundProcess.id)?.status.state === "exited");

    expect(manager.poll(backgroundProcess.id)!.status).toEqual({
      state: "exited",
      code: 0,
      signal: null,
    });
  });

  it("polls drain output incrementally", async () => {
    const manager = new BackgroundProcessManager(new OctoProcessManager());
    const backgroundProcess = manager.start("echo hello", "hello");

    let drained = "";
    await waitFor(() => {
      drained += manager.poll(backgroundProcess.id)!.drainUnreadOutput().stdout;
      return drained === "hello\n";
    });

    await waitFor(() => manager.poll(backgroundProcess.id)?.status.state === "exited");

    expect(manager.poll(backgroundProcess.id)!.drainUnreadOutput()).toEqual({
      stdout: "",
      stderr: "",
    });
    expect(backgroundProcess.outputExceeded).toBe(false);
  });

  it("keeps stdout and stderr separate", async () => {
    const manager = new BackgroundProcessManager(new OctoProcessManager());
    const backgroundProcess = manager.start("echo out && echo err >&2", "both-streams");

    let stdout = "";
    let stderr = "";
    await waitFor(() => {
      const drained = manager.poll(backgroundProcess.id)!.drainUnreadOutput();
      stdout += drained.stdout;
      stderr += drained.stderr;
      return stdout.includes("out") && stderr.includes("err");
    });

    await waitFor(() => manager.poll(backgroundProcess.id)?.status.state === "exited");

    expect(stdout).toBe("out\n");
    expect(stderr).toBe("err\n");
    expect(manager.poll(backgroundProcess.id)!.drainUnreadOutput()).toEqual({
      stdout: "",
      stderr: "",
    });
  });

  it("reports the command and label the process was started with", async () => {
    const manager = new BackgroundProcessManager(new OctoProcessManager());
    const backgroundProcess = manager.start("echo hello", "hello");

    expect(manager.poll(backgroundProcess.id)!.command).toBe("echo hello");
    expect(manager.poll(backgroundProcess.id)!.label).toBe("hello");

    await waitFor(() => manager.poll(backgroundProcess.id)?.status.state === "exited");
  });
});

describe("BackgroundProcessManager.kill", () => {
  it("terminates a long-running process", async () => {
    const manager = new BackgroundProcessManager(new OctoProcessManager());
    const backgroundProcess = manager.start("sleep 30", "sleeper");
    expect(manager.poll(backgroundProcess.id)!.status).toEqual({ state: "running" });

    expect(await manager.kill(backgroundProcess.id)).toBe(backgroundProcess);
    expect(backgroundProcess.status.state).toBe("exited");
  });
});

describe("BackgroundProcess.awaitChange", () => {
  it("waits up to the timeout when nothing changes", async () => {
    const manager = new BackgroundProcessManager(new OctoProcessManager());
    const backgroundProcess = manager.start("sleep 30", "sleeper");

    const start = Date.now();
    await backgroundProcess.awaitActivity(250, new AbortController().signal);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(200);
    expect(backgroundProcess.drainUnreadOutput()).toEqual({ stdout: "", stderr: "" });

    await manager.kill(backgroundProcess.id);
  });

  it("unblocks when output arrives", async () => {
    const manager = new BackgroundProcessManager(new OctoProcessManager());
    const backgroundProcess = manager.start("sleep 0.3 && echo late", "late-output");

    const start = Date.now();
    await backgroundProcess.awaitActivity(10_000, new AbortController().signal);
    const elapsed = Date.now() - start;

    expect(backgroundProcess.drainUnreadOutput().stdout).toContain("late");
    expect(elapsed).toBeLessThan(5_000);

    await waitFor(() => backgroundProcess.status.state === "exited");
  });

  it("unblocks when the process exits", async () => {
    const manager = new BackgroundProcessManager(new OctoProcessManager());
    const backgroundProcess = manager.start("sleep 0.3", "short-sleep");

    const start = Date.now();
    await backgroundProcess.awaitActivity(10_000, new AbortController().signal);
    const elapsed = Date.now() - start;

    expect(backgroundProcess.status.state).toBe("exited");
    expect(elapsed).toBeLessThan(5_000);
  });

  it("unblocks on abort", async () => {
    const manager = new BackgroundProcessManager(new OctoProcessManager());
    const backgroundProcess = manager.start("sleep 30", "sleeper");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    const start = Date.now();
    await backgroundProcess.awaitActivity(10_000, controller.signal);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(5_000);

    await manager.kill(backgroundProcess.id);
  });
});

describe("BackgroundProcessManager.list", () => {
  it("lists started processes with their ids, labels, commands, and statuses", async () => {
    const manager = new BackgroundProcessManager(new OctoProcessManager());
    const first = manager.start("echo hello", "hello");
    const second = manager.start("sleep 30", "sleeper");

    await waitFor(() => manager.poll(first.id)?.status.state === "exited");

    expect(
      manager.list().map(p => ({ id: p.id, label: p.label, command: p.command, status: p.status })),
    ).toEqual([
      {
        id: first.id,
        label: "hello",
        command: "echo hello",
        status: { state: "exited", code: 0, signal: null },
      },
      { id: second.id, label: "sleeper", command: "sleep 30", status: { state: "running" } },
    ]);

    await manager.kill(second.id);
  });

  it("is empty before any process is started", () => {
    const manager = new BackgroundProcessManager(new OctoProcessManager());

    expect(manager.list()).toEqual([]);
  });
});

describe("BackgroundProcessManager unknown ids", () => {
  it("returns null from poll and kill", async () => {
    const manager = new BackgroundProcessManager(new OctoProcessManager());

    expect(manager.poll("bg-process-1")).toBeNull();
    expect(await manager.kill("bg-process-1")).toBeNull();
  });
});

async function waitFor(cond: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
