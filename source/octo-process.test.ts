import { afterEach, describe, expect, it, jest } from "bun:test";
import { OctoProcessManager, type OctoProcess } from "./octo-process.ts";

/**
 * Each OctoProcessManager owns its own state (tracked processes, registered
 * cleanups, once-only flags), so tests construct their own instances and can't
 * leak state into each other — there's no shared module-global state to reset.
 */

function spawnSleeper(
  octoProcesses: OctoProcessManager,
  surviveAfterOctoExit = false,
): OctoProcess {
  return octoProcesses.spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
    stdio: "ignore",
    surviveAfterOctoExit,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("OctoProcessManager.spawn", () => {
  it("supports omitting the args array, like child_process.spawn", async () => {
    const octoProcess = new OctoProcessManager().spawn(process.execPath, { stdio: "ignore" });

    const code = await new Promise<number | null>(resolve => {
      octoProcess.once("close", code => resolve(code));
    });

    expect(code).toBe(0);
  });

  it("exit-tracks spawned processes so runCleanups terminates them", async () => {
    const manager = new OctoProcessManager();
    const octoProcess = spawnSleeper(manager);

    await manager.runCleanups();

    await waitFor(() => !isAlive(octoProcess.pid!));
  });

  it("does not exit-track processes spawned with surviveAfterOctoExit", async () => {
    const manager = new OctoProcessManager();
    const octoProcess = spawnSleeper(manager, true);

    await manager.runCleanups();
    // Give any mis-sent signal a chance to land
    await new Promise(resolve => setTimeout(resolve, 250));

    expect(isAlive(octoProcess.pid!)).toBe(true);

    octoProcess.kill("SIGKILL");
    await waitFor(() => !isAlive(octoProcess.pid!));
  });

  it("stops tracking processes when they close", async () => {
    const manager = new OctoProcessManager();
    const octoProcess = manager.spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await new Promise(resolve => octoProcess.once("close", resolve));
    const kill = jest.spyOn(octoProcess, "kill").mockReturnValue(true);

    manager.terminateAll();
    await manager.runCleanups();

    expect(kill).not.toHaveBeenCalled();
  });
});

describe("OctoProcess.terminate", () => {
  it("sends SIGTERM immediately and escalates to SIGKILL after graceMs", async () => {
    const octoProcess = spawnSleeper(new OctoProcessManager());
    jest.useFakeTimers();
    const kill = jest.spyOn(octoProcess, "kill").mockReturnValue(true);

    octoProcess.terminate({ graceMs: 100 });

    expect(kill).toHaveBeenCalledWith("SIGTERM");
    expect(kill).not.toHaveBeenCalledWith("SIGKILL");

    jest.advanceTimersByTime(99);
    expect(kill).not.toHaveBeenCalledWith("SIGKILL");
    jest.advanceTimersByTime(1);
    expect(kill).toHaveBeenCalledWith("SIGKILL");

    kill.mockRestore();
    jest.useRealTimers();
    octoProcess.kill("SIGKILL");
    await waitFor(() => !isAlive(octoProcess.pid!));
  });

  it.skipIf(process.platform === "win32")(
    "signals the whole process group for detached processes",
    async () => {
      const octoProcess = new OctoProcessManager().spawn("sleep", ["30"], {
        detached: true,
        stdio: "ignore",
      });
      const killSpy = jest.spyOn(process, "kill").mockImplementation(() => true);

      octoProcess.terminate();

      expect(killSpy).toHaveBeenCalledWith(-octoProcess.pid!, "SIGTERM");

      // Actually kill the real process, since process.kill was mocked
      killSpy.mockRestore();
      try {
        process.kill(-octoProcess.pid!, "SIGKILL");
      } catch {}
      await waitFor(() => !isAlive(octoProcess.pid!));
    },
  );

  it("signals only the process itself when not detached", async () => {
    const octoProcess = spawnSleeper(new OctoProcessManager());
    const processKillSpy = jest.spyOn(process, "kill").mockImplementation(() => true);
    const kill = jest.spyOn(octoProcess, "kill").mockReturnValue(true);

    octoProcess.terminate();

    expect(processKillSpy).not.toHaveBeenCalled();
    expect(kill).toHaveBeenCalledWith("SIGTERM");

    jest.restoreAllMocks();
    octoProcess.kill("SIGKILL");
    await waitFor(() => !isAlive(octoProcess.pid!));
  });

  it.skipIf(process.platform === "win32")(
    "falls back to signaling just the process if the group signal fails",
    async () => {
      const octoProcess = new OctoProcessManager().spawn("sleep", ["30"], {
        detached: true,
        stdio: "ignore",
      });
      jest.spyOn(process, "kill").mockImplementation(((pid: number) => {
        if (pid < 0) throw new Error("ESRCH: no such process group");
        return true;
      }) as typeof process.kill);
      const kill = jest.spyOn(octoProcess, "kill").mockReturnValue(true);

      octoProcess.terminate();

      expect(kill).toHaveBeenCalledWith("SIGTERM");

      jest.restoreAllMocks();
      try {
        process.kill(-octoProcess.pid!, "SIGKILL");
        octoProcess.kill("SIGKILL");
      } catch {}
      await waitFor(() => !isAlive(octoProcess.pid!));
    },
  );

  it("escalates to SIGKILL after the default grace period", async () => {
    const octoProcess = spawnSleeper(new OctoProcessManager());
    jest.useFakeTimers();
    const kill = jest.spyOn(octoProcess, "kill").mockReturnValue(true);

    octoProcess.terminate();

    expect(kill).toHaveBeenCalledWith("SIGTERM");
    jest.advanceTimersByTime(999);
    expect(kill).not.toHaveBeenCalledWith("SIGKILL");
    jest.advanceTimersByTime(1);
    expect(kill).toHaveBeenCalledWith("SIGKILL");

    kill.mockRestore();
    jest.useRealTimers();
    octoProcess.kill("SIGKILL");
    await waitFor(() => !isAlive(octoProcess.pid!));
  });

  it("is safe to call on a closed process and to call twice", async () => {
    const manager = new OctoProcessManager();
    const exited = manager.spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await new Promise(resolve => exited.once("close", resolve));
    expect(() => exited.terminate()).not.toThrow();

    const sleeper = spawnSleeper(manager);
    expect(() => {
      sleeper.terminate();
      sleeper.terminate();
    }).not.toThrow();

    await waitFor(() => !isAlive(sleeper.pid!));
  });

  it("works on processes spawned with surviveAfterOctoExit", async () => {
    const octoProcess = spawnSleeper(new OctoProcessManager(), true);

    octoProcess.terminate({ graceMs: 100 });

    await waitFor(() => !isAlive(octoProcess.pid!));
  });
});

describe("OctoProcessManager.terminateAll", () => {
  it("terminates only the manager's own processes", async () => {
    const here = new OctoProcessManager();
    const there = new OctoProcessManager();
    const mine = spawnSleeper(here);
    const theirs = spawnSleeper(there);
    const killMine = jest.spyOn(mine, "kill").mockReturnValue(true);
    const killTheirs = jest.spyOn(theirs, "kill").mockReturnValue(true);

    here.terminateAll({ graceMs: 5000 });

    expect(killMine).toHaveBeenCalledWith("SIGTERM");
    expect(killTheirs).not.toHaveBeenCalled();

    jest.restoreAllMocks();
    mine.kill("SIGKILL");
    theirs.kill("SIGKILL");
    await waitFor(() => !isAlive(mine.pid!) && !isAlive(theirs.pid!));
  });

  it("escalates to SIGKILL after the given graceMs", async () => {
    const manager = new OctoProcessManager();
    const octoProcess = spawnSleeper(manager);
    jest.useFakeTimers();
    const kill = jest.spyOn(octoProcess, "kill").mockReturnValue(true);

    manager.terminateAll({ graceMs: 100 });

    expect(kill).toHaveBeenCalledWith("SIGTERM");
    jest.advanceTimersByTime(100);
    expect(kill).toHaveBeenCalledWith("SIGKILL");

    kill.mockRestore();
    jest.useRealTimers();
    octoProcess.kill("SIGKILL");
    await waitFor(() => !isAlive(octoProcess.pid!));
  });
});

describe("OctoProcessManager.execFile", () => {
  it("buffers output to the callback, like child_process.execFile", async () => {
    const stdout = await new Promise<string | Buffer>((resolve, reject) => {
      new OctoProcessManager().execFile(
        process.execPath,
        ["-e", "console.log('hello')"],
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      );
    });

    expect(stdout.toString()).toBe("hello\n");
  });

  it("supports omitting the args array and options, like child_process.execFile", async () => {
    const stdoutPromise = new Promise<string | Buffer>((resolve, reject) => {
      // Can't use process.execPath here like the other tests: under `bun test`
      // that's the bun binary, and only node reads stdin as a script with no args.
      const octoProcess = new OctoProcessManager().execFile("node", (error, stdout) =>
        error ? reject(error) : resolve(stdout),
      );
      // node with no args reads stdin as a script; close it so it sees EOF and exits
      octoProcess.stdin!.end();
    });

    expect((await stdoutPromise).toString()).toBe("");
  });

  it("passes options through to child_process.execFile", async () => {
    const stdout = await new Promise<string | Buffer>((resolve, reject) => {
      new OctoProcessManager().execFile(
        process.execPath,
        ["-e", "process.stdout.write('buffered')"],
        { encoding: "buffer" },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      );
    });

    expect(Buffer.isBuffer(stdout)).toBe(true);
    expect(stdout.toString()).toBe("buffered");
  });

  it("reports spawn failures to the callback, like child_process.execFile", async () => {
    const error = await new Promise<Error | null>(resolve => {
      new OctoProcessManager().execFile(process.execPath, ["-e", "process.exit(3)"], error =>
        resolve(error),
      );
    });

    expect(error).not.toBeNull();
    expect((error as unknown as { code: number }).code).toBe(3);
  });

  it("does not exit-track processes spawned with surviveAfterOctoExit", async () => {
    const manager = new OctoProcessManager();
    const octoProcess = manager.execFile(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
      surviveAfterOctoExit: true,
    });

    await manager.runCleanups();
    // Give any mis-sent signal a chance to land
    await new Promise(resolve => setTimeout(resolve, 250));

    expect(isAlive(octoProcess.pid!)).toBe(true);

    octoProcess.kill("SIGKILL");
    await waitFor(() => !isAlive(octoProcess.pid!));
  });

  it("exit-tracks spawned processes so runCleanups terminates them", async () => {
    const manager = new OctoProcessManager();
    const octoProcess = manager.execFile(process.execPath, ["-e", "setTimeout(() => {}, 30000)"]);

    await manager.runCleanups();

    await waitFor(() => !isAlive(octoProcess.pid!));
  });
});

describe("OctoProcessManager.runCleanups", () => {
  it("runs registered cleanups once, tolerates failures, and terminates remaining processes", async () => {
    const manager = new OctoProcessManager();
    const calls: string[] = [];
    manager.registerCleanup(() => {
      calls.push("sync");
    });
    manager.registerCleanup(async () => {
      calls.push("async");
    });
    manager.registerCleanup(() => {
      throw new Error("a failing cleanup must not block the others");
    });
    const octoProcess = spawnSleeper(manager);
    const kill = jest.spyOn(octoProcess, "kill").mockReturnValue(true);

    await manager.runCleanups();

    expect(calls.sort()).toEqual(["async", "sync"]);
    expect(kill).toHaveBeenCalledWith("SIGTERM");

    await manager.runCleanups();
    expect(calls.sort()).toEqual(["async", "sync"]);

    kill.mockRestore();
    octoProcess.kill("SIGKILL");
    await waitFor(() => !isAlive(octoProcess.pid!));
  });

  it("does not run unregistered cleanups", async () => {
    const manager = new OctoProcessManager();
    const cleanup = jest.fn();
    const unregister = manager.registerCleanup(cleanup);

    unregister();
    // Unregistering twice must be harmless
    expect(() => unregister()).not.toThrow();
    await manager.runCleanups();

    expect(cleanup).not.toHaveBeenCalled();
  });

  it("does not share cleanups between manager instances", async () => {
    const here = new OctoProcessManager();
    const there = new OctoProcessManager();
    const cleanup = jest.fn();
    there.registerCleanup(cleanup);

    await here.runCleanups();

    expect(cleanup).not.toHaveBeenCalled();
  });

  it("bounds hung cleanups by a timeout so shutdown can't be blocked", async () => {
    jest.useFakeTimers();
    const manager = new OctoProcessManager();
    manager.registerCleanup(() => new Promise<void>(() => {}));

    const promise = manager.runCleanups();
    jest.advanceTimersByTime(5000);

    // Resolves thanks to the cleanup timeout rather than hanging forever
    await promise;
  });
});

describe("OctoProcessManager.installGlobalProcessSignalHandlers", () => {
  it("installs one handler per termination signal and is idempotent", async () => {
    const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
    const listenersBefore = new Map(
      signals.map(signal => [signal, process.listeners(signal)] as const),
    );
    const exitListenersBefore = process.listeners("exit");

    const manager = new OctoProcessManager();
    try {
      manager.installGlobalProcessSignalHandlers();
      manager.installGlobalProcessSignalHandlers();

      for (const signal of signals) {
        expect(process.listenerCount(signal)).toBe(listenersBefore.get(signal)!.length + 1);
      }
      expect(process.listenerCount("exit")).toBe(exitListenersBefore.length + 1);
    } finally {
      // Remove the manager's listeners so a stray signal during the test run
      // can't trigger the real shutdown path.
      for (const signal of signals) {
        for (const listener of process.listeners(signal)) {
          if (!listenersBefore.get(signal)!.includes(listener)) {
            process.removeListener(signal, listener);
          }
        }
      }
      for (const listener of process.listeners("exit")) {
        if (!exitListenersBefore.includes(listener)) {
          process.removeListener("exit", listener);
        }
      }
    }
  });

  it("runs cleanups, re-raises the signal, and force-exits if the re-raise is swallowed", async () => {
    const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
    // Bypass process.listeners' overloads, which don't accept a union of signals and "exit"
    const listeners = process.listeners.bind(process) as (
      event: string,
    ) => ((...args: any[]) => void)[];
    const listenersBefore = new Map(
      [...signals, "exit"].map(signal => [signal, listeners(signal)] as const),
    );
    const manager = new OctoProcessManager();
    const cleanup = jest.fn();
    manager.registerCleanup(cleanup);
    // Swallow the re-raised signal and intercept exit so the test runner survives
    const kill = jest.spyOn(process, "kill").mockImplementation(() => true);
    const exit = jest.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    try {
      manager.installGlobalProcessSignalHandlers();
      const handler = process
        .listeners("SIGTERM")
        .find(listener => !listenersBefore.get("SIGTERM")!.includes(listener)) as () => void;

      handler();

      // The handler should re-raise SIGTERM to this process after cleanup
      await waitFor(() =>
        kill.mock.calls.some(([pid, signal]) => pid === process.pid && signal === "SIGTERM"),
      );
      expect(cleanup).toHaveBeenCalledTimes(1);

      // A second signal arriving mid-shutdown must be ignored
      handler();
      expect(cleanup).toHaveBeenCalledTimes(1);

      // Since the mocked process.kill swallowed the re-raise, the fallback
      // must force an exit with the conventional 128 + signo code (SIGTERM is 15).
      // Waiting for it to fire also drains its timer before the exit mock is restored.
      await waitFor(() => exit.mock.calls.length > 0);
      expect(exit).toHaveBeenCalledWith(143);
    } finally {
      for (const [signal, before] of listenersBefore) {
        for (const listener of listeners(signal)) {
          if (!before.includes(listener)) {
            process.removeListener(signal, listener);
          }
        }
      }
    }
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

async function waitFor(cond: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
