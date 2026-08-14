import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { BackgroundProcessManager, BackgroundProcessState } from "./background-processes.ts";
import { killAllOctoProcesses } from "./octo-process.ts";

let tempDirs: string[] = [];
let spawnedPids: number[] = [];

function track(state: BackgroundProcessState) {
  if (state.pid != null) spawnedPids.push(state.pid);
  return state;
}

async function tempStateDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "octo-background-processes-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  killAllOctoProcesses();
  for (const pid of spawnedPids) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
  }
  spawnedPids = [];
  for (const dir of tempDirs) await fs.rm(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("BackgroundProcessManager", () => {
  it("spawns a session process, reports it running, captures output, and kills it", async () => {
    const manager = new BackgroundProcessManager({ stateDir: await tempStateDir() });

    const state = track(
      await manager.spawn({
        name: "dev-server",
        command: "echo hello-from-background && sleep 30",
        cwd: process.cwd(),
      }),
    );

    expect(state.status).toBe("running");
    expect(state.global).toBe(false);
    expect(state.pid).not.toBeNull();
    expect((await manager.status("dev-server")).status).toBe("running");

    const output = await waitFor(async () => {
      const { output } = await manager.output("dev-server");
      return output.includes("hello-from-background") ? output : null;
    });
    expect(output).toContain("hello-from-background");

    const killed = await manager.kill("dev-server");
    expect(killed.status).toBe("killed");
    await waitFor(() => !isAlive(state.pid!));
    expect((await manager.status("dev-server")).status).toBe("killed");
  });

  it("records the exit code when a process finishes on its own", async () => {
    const manager = new BackgroundProcessManager({ stateDir: await tempStateDir() });

    const state = await manager.spawn({
      name: "fails",
      command: "exit 3",
      cwd: process.cwd(),
    });
    if (state.pid != null) spawnedPids.push(state.pid);

    const status = await waitFor(async () => {
      const current = await manager.status("fails");
      return current.status === "exited" ? current : null;
    });
    expect(status.exitCode).toBe(3);
  });

  it("truncates output to a requested number of trailing lines", async () => {
    const manager = new BackgroundProcessManager({ stateDir: await tempStateDir() });

    track(
      await manager.spawn({
        name: "noisy",
        command: "echo one && echo two && echo three && sleep 30",
        cwd: process.cwd(),
      }),
    );

    const result = await waitFor(async () => {
      const result = await manager.output("noisy", { lines: 2 });
      return result.output.includes("three") ? result : null;
    });
    expect(result.output).toContain("earlier lines omitted");
    const lines = result.output.trim().split("\n");
    expect(lines[lines.length - 2]).toBe("two");
    expect(lines[lines.length - 1]).toBe("three");
  });

  it("rejects duplicate names for processes that are still running", async () => {
    const manager = new BackgroundProcessManager({ stateDir: await tempStateDir() });
    track(await manager.spawn({ name: "dup", command: "sleep 30", cwd: process.cwd() }));

    await expect(
      manager.spawn({ name: "dup", command: "sleep 30", cwd: process.cwd() }),
    ).rejects.toThrow(/already running/);
  });

  it("rejects names that aren't safe directory names", async () => {
    const manager = new BackgroundProcessManager({ stateDir: await tempStateDir() });
    await expect(
      manager.spawn({ name: "../evil", command: "sleep 30", cwd: process.cwd(), global: true }),
    ).rejects.toThrow(/Invalid name/);
  });

  it("errors on unknown names", async () => {
    const manager = new BackgroundProcessManager({ stateDir: await tempStateDir() });
    await expect(manager.status("nope")).rejects.toThrow(/No background process named/);
    await expect(manager.kill("nope")).rejects.toThrow(/No background process named/);
    await expect(manager.output("nope")).rejects.toThrow(/No background process named/);
  });

  it("lists tracked processes", async () => {
    const manager = new BackgroundProcessManager({ stateDir: await tempStateDir() });
    expect(await manager.list()).toEqual([]);

    track(await manager.spawn({ name: "web", command: "sleep 30", cwd: process.cwd() }));

    const states = await manager.list();
    expect(states).toHaveLength(1);
    expect(states[0].name).toBe("web");
    expect(states[0].status).toBe("running");
  });

  describe("global processes", () => {
    it("persists metadata on spawn and reattaches from a fresh manager after a restart", async () => {
      const stateDir = await tempStateDir();
      const first = new BackgroundProcessManager({ stateDir });

      const state = track(
        await first.spawn({
          name: "global-server",
          command: "echo persisted-output && sleep 30",
          cwd: process.cwd(),
          global: true,
        }),
      );
      expect(state.global).toBe(true);

      const meta = JSON.parse(
        await fs.readFile(path.join(stateDir, "global-server", "meta.json"), "utf8"),
      );
      expect(meta).toMatchObject({ name: "global-server", status: "running", pid: state.pid });

      // A new manager with an empty in-memory registry == a fresh Octo session.
      const second = new BackgroundProcessManager({ stateDir });
      const attached = await second.status("global-server");
      expect(attached.status).toBe("running");
      expect(attached.pid).toBe(state.pid);

      const output = await waitFor(async () => {
        const { output } = await second.output("global-server");
        return output.includes("persisted-output") ? output : null;
      });
      expect(output).toContain("persisted-output");

      const killed = await second.kill("global-server");
      expect(killed.status).toBe("killed");
      await waitFor(() => !isAlive(state.pid!));
    });

    it("detects (via the exit file) that a global process exited while Octo was down", async () => {
      const stateDir = await tempStateDir();
      const first = new BackgroundProcessManager({ stateDir });

      const state = track(
        await first.spawn({
          name: "short-lived",
          command: "echo done && exit 7",
          cwd: process.cwd(),
          global: true,
        }),
      );
      await waitFor(() => !isAlive(state.pid!));

      const second = new BackgroundProcessManager({ stateDir });
      const attached = await second.status("short-lived");
      expect(attached.status).toBe("exited");
      expect(attached.exitCode).toBe(7);
    });

    it("rehydrates global processes into list", async () => {
      const stateDir = await tempStateDir();
      const first = new BackgroundProcessManager({ stateDir });
      track(
        await first.spawn({
          name: "another-server",
          command: "sleep 30",
          cwd: process.cwd(),
          global: true,
        }),
      );

      const second = new BackgroundProcessManager({ stateDir });
      const states = await second.list();
      expect(states.map(s => s.name)).toEqual(["another-server"]);
    });
  });
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the process exists but we can't signal it
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function waitFor<T>(
  cond: () => T | Promise<T | null> | null,
  timeoutMs = 10_000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await cond();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
