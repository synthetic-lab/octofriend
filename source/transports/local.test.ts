import { afterEach, describe, expect, it, jest } from "bun:test";
import { ProcessManager } from "../process-manager.ts";
import { LocalTransport } from "./local.ts";
import type { TransportProcess } from "./transport-process.ts";

function spawnSleeper(
  processManager: ProcessManager,
  surviveAfterOctoExit = false,
): TransportProcess {
  return new LocalTransport(processManager).spawn(
    process.execPath,
    ["-e", "setTimeout(() => {}, 30000)"],
    {
      stdio: "ignore",
      surviveAfterOctoExit,
    },
  );
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("LocalTransport.spawn", () => {
  it("closing a transport terminates only that transport's processes", async () => {
    const manager = new ProcessManager();
    const here = new LocalTransport(manager);
    const there = new LocalTransport(manager);
    const mine = here.spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
      stdio: "ignore",
    });
    const theirs = there.spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
      stdio: "ignore",
    });
    try {
      await here.close();
      expect(isAlive(mine.pid!)).toBe(false);
      expect(isAlive(theirs.pid!)).toBe(true);
    } finally {
      await there.close();
    }
  });

  it("supports omitting the args array, like child_process.spawn", async () => {
    const child = new LocalTransport(new ProcessManager()).spawn(process.execPath, {
      stdio: "ignore",
    });

    const code = await new Promise<number | null>(resolve => {
      child.once("close", code => resolve(code));
    });

    expect(code).toBe(0);
  });

  it("exit-tracks spawned processes so runCleanups terminates them", async () => {
    const manager = new ProcessManager();
    const child = spawnSleeper(manager);

    await manager.runCleanups();

    await waitFor(() => !isAlive(child.pid!));
  });

  it("does not exit-track processes spawned with surviveAfterOctoExit", async () => {
    const manager = new ProcessManager();
    const child = spawnSleeper(manager, true);

    await manager.runCleanups();
    await new Promise(resolve => setTimeout(resolve, 250));

    expect(isAlive(child.pid!)).toBe(true);

    child.kill("SIGKILL");
    await waitFor(() => !isAlive(child.pid!));
  });

  it("stops tracking processes when they close", async () => {
    const manager = new ProcessManager();
    const child = new LocalTransport(manager).spawn(process.execPath, ["-e", ""], {
      stdio: "ignore",
    });
    await new Promise(resolve => child.once("close", resolve));
    const kill = jest.spyOn(child, "kill").mockReturnValue(true);

    manager.terminateAll();
    await manager.runCleanups();

    expect(kill).not.toHaveBeenCalled();
  });
});

describe("TransportProcess.terminate", () => {
  it("sends SIGTERM immediately and escalates to SIGKILL after graceMs", async () => {
    const child = spawnSleeper(new ProcessManager());
    jest.useFakeTimers();
    const kill = jest.spyOn(child, "kill").mockReturnValue(true);

    child.terminate({ graceMs: 100 });

    expect(kill).toHaveBeenCalledWith("SIGTERM");
    expect(kill).not.toHaveBeenCalledWith("SIGKILL");

    jest.advanceTimersByTime(99);
    expect(kill).not.toHaveBeenCalledWith("SIGKILL");
    jest.advanceTimersByTime(1);
    expect(kill).toHaveBeenCalledWith("SIGKILL");

    kill.mockRestore();
    jest.useRealTimers();
    child.kill("SIGKILL");
    await waitFor(() => !isAlive(child.pid!));
  });

  it.skipIf(process.platform === "win32")(
    "signals the whole process group for detached processes",
    async () => {
      const child = new LocalTransport(new ProcessManager()).spawn("sleep", ["30"], {
        detached: true,
        stdio: "ignore",
      });
      const killSpy = jest.spyOn(process, "kill").mockImplementation(() => true);

      child.terminate();

      expect(killSpy).toHaveBeenCalledWith(-child.pid!, "SIGTERM");

      killSpy.mockRestore();
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {}
      await waitFor(() => !isAlive(child.pid!));
    },
  );

  it("signals only the process itself when not detached", async () => {
    const child = spawnSleeper(new ProcessManager());
    const processKillSpy = jest.spyOn(process, "kill").mockImplementation(() => true);
    const kill = jest.spyOn(child, "kill").mockReturnValue(true);

    child.terminate();

    expect(processKillSpy).not.toHaveBeenCalled();
    expect(kill).toHaveBeenCalledWith("SIGTERM");

    jest.restoreAllMocks();
    child.kill("SIGKILL");
    await waitFor(() => !isAlive(child.pid!));
  });

  it.skipIf(process.platform === "win32")(
    "falls back to signaling just the process if the group signal fails",
    async () => {
      const child = new LocalTransport(new ProcessManager()).spawn("sleep", ["30"], {
        detached: true,
        stdio: "ignore",
      });
      jest.spyOn(process, "kill").mockImplementation(((pid: number) => {
        if (pid < 0) throw new Error("ESRCH: no such process group");
        return true;
      }) as typeof process.kill);
      const kill = jest.spyOn(child, "kill").mockReturnValue(true);

      child.terminate();

      expect(kill).toHaveBeenCalledWith("SIGTERM");

      jest.restoreAllMocks();
      try {
        process.kill(-child.pid!, "SIGKILL");
        child.kill("SIGKILL");
      } catch {}
      await waitFor(() => !isAlive(child.pid!));
    },
  );

  it("escalates to SIGKILL after the default grace period", async () => {
    const child = spawnSleeper(new ProcessManager());
    jest.useFakeTimers();
    const kill = jest.spyOn(child, "kill").mockReturnValue(true);

    child.terminate();

    expect(kill).toHaveBeenCalledWith("SIGTERM");
    jest.advanceTimersByTime(999);
    expect(kill).not.toHaveBeenCalledWith("SIGKILL");
    jest.advanceTimersByTime(1);
    expect(kill).toHaveBeenCalledWith("SIGKILL");

    kill.mockRestore();
    jest.useRealTimers();
    child.kill("SIGKILL");
    await waitFor(() => !isAlive(child.pid!));
  });

  it("is safe to call on a closed process and to call twice", async () => {
    const manager = new ProcessManager();
    const exited = new LocalTransport(manager).spawn(process.execPath, ["-e", ""], {
      stdio: "ignore",
    });
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
    const child = spawnSleeper(new ProcessManager(), true);

    child.terminate({ graceMs: 100 });

    await waitFor(() => !isAlive(child.pid!));
  });
});

describe("LocalTransport.execFile", () => {
  it("reports missing executables to the callback and prunes them", async () => {
    const manager = new ProcessManager();
    const transport = new LocalTransport(manager);
    let child: TransportProcess;
    const error = await new Promise<Error | null>(resolve => {
      child = transport.execFile("/octo-missing-executable", error => resolve(error));
    });
    await child!.processClosedPromise;
    const kill = jest.spyOn(child!, "kill");
    await manager.terminateAll();
    expect(error).toMatchObject({ code: "ENOENT" });
    expect(kill).not.toHaveBeenCalled();
  });

  it("buffers output to the callback, like child_process.execFile", async () => {
    const stdout = await new Promise<string | Buffer>((resolve, reject) => {
      new LocalTransport(new ProcessManager()).execFile(
        process.execPath,
        ["-e", "console.log('hello')"],
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      );
    });

    expect(stdout.toString()).toBe("hello\n");
  });

  it("supports omitting the args array and options, like child_process.execFile", async () => {
    const stdoutPromise = new Promise<string | Buffer>((resolve, reject) => {
      const child = new LocalTransport(new ProcessManager()).execFile("node", (error, stdout) =>
        error ? reject(error) : resolve(stdout),
      );
      child.stdin!.end();
    });

    expect((await stdoutPromise).toString()).toBe("");
  });

  it("passes options through to child_process.execFile", async () => {
    const stdout = await new Promise<string | Buffer>((resolve, reject) => {
      new LocalTransport(new ProcessManager()).execFile(
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
      new LocalTransport(new ProcessManager()).execFile(
        process.execPath,
        ["-e", "process.exit(3)"],
        error => resolve(error),
      );
    });

    expect(error).not.toBeNull();
    expect((error as unknown as { code: number }).code).toBe(3);
  });

  it("does not exit-track processes spawned with surviveAfterOctoExit", async () => {
    const manager = new ProcessManager();
    const child = new LocalTransport(manager).execFile(
      process.execPath,
      ["-e", "setTimeout(() => {}, 30000)"],
      {
        surviveAfterOctoExit: true,
      },
    );

    await manager.runCleanups();
    await new Promise(resolve => setTimeout(resolve, 250));

    expect(isAlive(child.pid!)).toBe(true);

    child.kill("SIGKILL");
    await waitFor(() => !isAlive(child.pid!));
  });

  it("exit-tracks spawned processes so runCleanups terminates them", async () => {
    const manager = new ProcessManager();
    const child = new LocalTransport(manager).execFile(process.execPath, [
      "-e",
      "setTimeout(() => {}, 30000)",
    ]);

    await manager.runCleanups();

    await waitFor(() => !isAlive(child.pid!));
  });
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
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
