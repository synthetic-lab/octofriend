import { unwrap } from "./libocto/result.ts";
import { describe, expect, it } from "bun:test";
import { MockTransport, MockTransportProcess } from "./transports/mock.ts";
import { AbortError } from "./transports/transport-common.ts";
import { LocalTransport } from "./transports/local.ts";
import { BackgroundProcessManager } from "./background-process.ts";
import { mkdtemp, realpath, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

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

  it("uses the transport's working directory", async () => {
    const cwd = await realpath(await mkdtemp(path.join(tmpdir(), "octo-background-")));
    const transport = new LocalTransport();
    transport.cwd = cwd;
    try {
      const background = unwrap(
        transport.backgroundShell({
          command: "pwd",
          label: "cwd",
          signal: new AbortController().signal,
          backgroundProcessManager: new BackgroundProcessManager(),
        }),
      );
      await waitFor(() => background.status.state === "exited");
      expect(background.drainUnreadOutput().stdout.trim()).toBe(cwd);
    } finally {
      await transport.close();
      await rm(cwd, { recursive: true });
    }
  });

  it("runs the command and polls report the exit", async () => {
    const manager = new BackgroundProcessManager();
    const backgroundProcess = unwrap(
      new LocalTransport().backgroundShell({
        command: "echo hello",
        label: "hello",
        signal: new AbortController().signal,
        backgroundProcessManager: manager,
      }),
    );

    await waitFor(() => manager.poll(backgroundProcess.id)?.status.state === "exited");

    expect(manager.poll(backgroundProcess.id)!.status).toEqual({
      state: "exited",
      code: 0,
      signal: null,
    });
  });

  it("polls drain output incrementally", async () => {
    const manager = new BackgroundProcessManager();
    const backgroundProcess = unwrap(
      new LocalTransport().backgroundShell({
        command: "echo hello",
        label: "hello",
        signal: new AbortController().signal,
        backgroundProcessManager: manager,
      }),
    );

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
    const manager = new BackgroundProcessManager();
    const backgroundProcess = unwrap(
      new LocalTransport().backgroundShell({
        command: "echo out && echo err >&2",
        label: "both-streams",
        signal: new AbortController().signal,
        backgroundProcessManager: manager,
      }),
    );

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
    const manager = new BackgroundProcessManager();
    const backgroundProcess = unwrap(
      new LocalTransport().backgroundShell({
        command: "echo hello",
        label: "hello",
        signal: new AbortController().signal,
        backgroundProcessManager: manager,
      }),
    );

    expect(manager.poll(backgroundProcess.id)!.command).toBe("echo hello");
    expect(manager.poll(backgroundProcess.id)!.label).toBe("hello");

    await waitFor(() => manager.poll(backgroundProcess.id)?.status.state === "exited");
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

describe("BackgroundProcessManager.kill", () => {
  it("terminates a long-running process", async () => {
    const manager = new BackgroundProcessManager();
    const backgroundProcess = unwrap(
      new LocalTransport().backgroundShell({
        command: "sleep 30",
        label: "sleeper",
        signal: new AbortController().signal,
        backgroundProcessManager: manager,
      }),
    );
    expect(manager.poll(backgroundProcess.id)!.status).toEqual({ state: "running" });

    expect(await manager.kill(backgroundProcess.id)).toBe(backgroundProcess);
    expect(backgroundProcess.status.state).toBe("exited");
  });
});

describe("BackgroundProcess.awaitChange", () => {
  it("waits up to the timeout when nothing changes", async () => {
    const manager = new BackgroundProcessManager();
    const backgroundProcess = unwrap(
      new LocalTransport().backgroundShell({
        command: "sleep 30",
        label: "sleeper",
        signal: new AbortController().signal,
        backgroundProcessManager: manager,
      }),
    );

    const start = Date.now();
    await backgroundProcess.awaitActivity(250, new AbortController().signal);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(200);
    expect(backgroundProcess.drainUnreadOutput()).toEqual({ stdout: "", stderr: "" });

    await manager.kill(backgroundProcess.id);
  });

  it("unblocks when output arrives", async () => {
    const manager = new BackgroundProcessManager();
    const backgroundProcess = unwrap(
      new LocalTransport().backgroundShell({
        command: "sleep 0.3 && echo late",
        label: "late-output",
        signal: new AbortController().signal,
        backgroundProcessManager: manager,
      }),
    );

    const start = Date.now();
    await backgroundProcess.awaitActivity(10_000, new AbortController().signal);
    const elapsed = Date.now() - start;

    expect(backgroundProcess.drainUnreadOutput().stdout).toContain("late");
    expect(elapsed).toBeLessThan(5_000);

    await waitFor(() => backgroundProcess.status.state === "exited");
  });

  it("unblocks when the process exits", async () => {
    const manager = new BackgroundProcessManager();
    const backgroundProcess = unwrap(
      new LocalTransport().backgroundShell({
        command: "sleep 0.3",
        label: "short-sleep",
        signal: new AbortController().signal,
        backgroundProcessManager: manager,
      }),
    );

    const start = Date.now();
    await backgroundProcess.awaitActivity(10_000, new AbortController().signal);
    const elapsed = Date.now() - start;

    expect(backgroundProcess.status.state).toBe("exited");
    expect(elapsed).toBeLessThan(5_000);
  });

  it("unblocks on abort", async () => {
    const manager = new BackgroundProcessManager();
    const backgroundProcess = unwrap(
      new LocalTransport().backgroundShell({
        command: "sleep 30",
        label: "sleeper",
        signal: new AbortController().signal,
        backgroundProcessManager: manager,
      }),
    );
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
    const manager = new BackgroundProcessManager();
    const first = unwrap(
      new LocalTransport().backgroundShell({
        command: "echo hello",
        label: "hello",
        signal: new AbortController().signal,
        backgroundProcessManager: manager,
      }),
    );
    const second = unwrap(
      new LocalTransport().backgroundShell({
        command: "sleep 30",
        label: "sleeper",
        signal: new AbortController().signal,
        backgroundProcessManager: manager,
      }),
    );

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

async function waitFor(cond: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
