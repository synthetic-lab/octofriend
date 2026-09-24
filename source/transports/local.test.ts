import { afterEach, describe, expect, it, jest } from "bun:test";
import { withMock } from "antipattern";
import { ProcessManager, processes } from "../process-manager.ts";
import { LocalTransport } from "./local.ts";
import type { TransportProcess } from "./transport-process.ts";
import { once } from "events";

async function withTestManager(cb: (manager: ProcessManager) => Promise<void>): Promise<void> {
  const manager = new ProcessManager();
  await withMock(
    processes,
    "manager",
    () => manager,
    () => cb(manager),
  );
}

function spawnSleeper(surviveAfterOctoExit = false): TransportProcess {
  return new LocalTransport().spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
    stdio: "ignore",
    surviveAfterOctoExit,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("LocalTransport.spawn", () => {
  it("global shutdown cleans up resources and ordinary children while preserving survivors", async () =>
    withTestManager(async manager => {
      const transport = new LocalTransport();
      const ordinary = transport.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "ignore",
      });
      const survivor = transport.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "ignore",
        surviveAfterOctoExit: true,
      });
      const cleanup = jest.fn(async () => {});
      manager.registerOctoExitCleanup(cleanup);
      try {
        await manager.terminateOnOctoExit();
        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(isAlive(ordinary.pid!)).toBe(false);
        expect(isAlive(survivor.pid!)).toBe(true);
      } finally {
        await transport.close();
      }
    }));

  it("closing a transport terminates only that transport's processes", async () => {
    const here = new LocalTransport();
    const there = new LocalTransport();
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

  it("supports an empty args array", async () => {
    const child = new LocalTransport().spawn(process.execPath, [], {
      stdio: "ignore",
    });

    const code = await new Promise<number | null>(resolve => {
      child.once("close", code => resolve(code));
    });

    expect(code).toBe(0);
  });

  it("exit-tracks spawned processes so terminateOnOctoExit terminates them", async () =>
    withTestManager(async manager => {
      const child = spawnSleeper();

      await manager.terminateOnOctoExit();

      await waitFor(() => !isAlive(child.pid!));
    }));

  it("does not exit-track processes spawned with surviveAfterOctoExit", async () =>
    withTestManager(async manager => {
      const child = spawnSleeper(true);

      await manager.terminateOnOctoExit();
      await new Promise(resolve => setTimeout(resolve, 250));

      expect(isAlive(child.pid!)).toBe(true);

      child.kill("SIGKILL");
      await waitFor(() => !isAlive(child.pid!));
    }));

  it("stops tracking processes when they close", async () =>
    withTestManager(async manager => {
      const child = new LocalTransport().spawn(process.execPath, ["-e", ""], {
        stdio: "ignore",
      });
      await new Promise(resolve => child.once("close", resolve));
      const kill = jest.spyOn(child, "kill").mockReturnValue(true);

      await manager.terminateOnOctoExit();

      expect(kill).not.toHaveBeenCalled();
    }));
});

describe("TransportProcess.terminate", () => {
  it.skipIf(process.platform === "win32")(
    "waits for escalation after the parent closes and kills a descendant that ignores SIGTERM",
    async () => {
      const transport = new LocalTransport();
      const childCode = `process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1000);`;
      const parentCode = `
        const { spawn } = require("child_process");
        const child = spawn(process.execPath, ["-e", ${JSON.stringify(childCode)}], { stdio: ["ignore", "pipe", "ignore"] });
        child.stdout.once("data", () => console.log(child.pid));
        process.on("SIGTERM", () => process.exit(0));
        setInterval(() => {}, 1000);
      `;
      const parent = transport.spawn(process.execPath, ["-e", parentCode], {
        detached: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
      let descendantPid: number | undefined;
      try {
        const [output] = await once(parent.stdout!, "data");
        descendantPid = Number(output.toString().trim());
        expect(Number.isSafeInteger(descendantPid)).toBe(true);
        let completed = false;
        const closed = once(parent, "close");
        const terminating = parent.terminate({ graceMs: 300 }).then(() => {
          completed = true;
        });
        await closed;
        expect(isAlive(parent.pid!)).toBe(false);
        expect(isAlive(descendantPid)).toBe(true);
        expect(completed).toBe(false);
        await Promise.all([terminating, parent.processClosedPromise]);
        await waitFor(() => !isAlive(descendantPid!));
        expect(completed).toBe(true);
      } finally {
        await parent.terminate({ graceMs: 0 });
        if (descendantPid !== undefined && isAlive(descendantPid))
          process.kill(descendantPid, "SIGKILL");
      }
    },
  );

  it("settles both callers when immediate termination interrupts graceful termination", async () => {
    const child = new LocalTransport().spawn(
      process.execPath,
      ["-e", 'process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1000);'],
      {
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    try {
      await once(child.stdout!, "data");
      const graceful = child.terminate({ graceMs: 5000 });
      const immediate = child.terminate({ graceMs: 0 });
      await Promise.all([graceful, immediate, child.processClosedPromise]);
      expect(isAlive(child.pid!)).toBe(false);
    } finally {
      await child.terminate({ graceMs: 0 });
    }
  });

  it("settles overlapping transport closure and global cleanup", async () =>
    withTestManager(async manager => {
      const transport = new LocalTransport();
      const child = transport.spawn(
        process.execPath,
        ["-e", 'console.log("ready"); setInterval(() => {}, 1000);'],
        {
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
      try {
        await once(child.stdout!, "data");
        await Promise.all([
          transport.close(),
          manager.terminateOnOctoExit(),
          child.processClosedPromise,
        ]);
        expect(isAlive(child.pid!)).toBe(false);
      } finally {
        await child.terminate({ graceMs: 0 });
      }
    }));

  it("sends SIGTERM immediately and escalates to SIGKILL after graceMs", async () => {
    const child = spawnSleeper();
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
      const child = new LocalTransport().spawn("sleep", ["30"], {
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
    const child = spawnSleeper();
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
      const child = new LocalTransport().spawn("sleep", ["30"], {
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
    const child = spawnSleeper();
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
    const exited = new LocalTransport().spawn(process.execPath, ["-e", ""], {
      stdio: "ignore",
    });
    await new Promise(resolve => exited.once("close", resolve));
    expect(() => exited.terminate()).not.toThrow();

    const sleeper = spawnSleeper();
    expect(() => {
      sleeper.terminate();
      sleeper.terminate();
    }).not.toThrow();

    await waitFor(() => !isAlive(sleeper.pid!));
  });

  it("works on processes spawned with surviveAfterOctoExit", async () => {
    const child = spawnSleeper(true);

    child.terminate({ graceMs: 100 });

    await waitFor(() => !isAlive(child.pid!));
  });
});

describe("LocalTransport.execFile", () => {
  it("reports missing executables to the callback and prunes them", async () =>
    withTestManager(async manager => {
      const transport = new LocalTransport();
      let child: TransportProcess;
      const error = await new Promise<Error | null>(resolve => {
        child = transport.execFile("/octo-missing-executable", [], {}, error => resolve(error));
      });
      await child!.processClosedPromise;
      const kill = jest.spyOn(child!, "kill");
      await manager.terminateOnOctoExit();
      expect(error).toMatchObject({ code: "ENOENT" });
      expect(kill).not.toHaveBeenCalled();
    }));

  it("buffers output to the callback, like child_process.execFile", async () => {
    const stdout = await new Promise<string>((resolve, reject) => {
      new LocalTransport().execFile(
        process.execPath,
        ["-e", "console.log('hello')"],
        {},
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      );
    });

    expect(stdout).toBe("hello\n");
  });

  it("supports an empty args array and options", async () => {
    const stdoutPromise = new Promise<string>((resolve, reject) => {
      const child = new LocalTransport().execFile("node", [], {}, (error, stdout) =>
        error ? reject(error) : resolve(stdout),
      );
      child.stdin!.end();
    });

    expect(await stdoutPromise).toBe("");
  });

  it("passes environment and literal arguments without a shell", async () => {
    const stdout = await new Promise<string>((resolve, reject) => {
      new LocalTransport().execFile(
        process.execPath,
        [
          "-e",
          "process.stdout.write(process.env.MESSAGE + process.argv[1])",
          "$MESSAGE; echo unexpected",
        ],
        { env: { MESSAGE: "hello " } },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      );
    });

    expect(stdout).toBe("hello $MESSAGE; echo unexpected");
  });

  it("reports spawn failures to the callback, like child_process.execFile", async () => {
    const error = await new Promise<Error | null>(resolve => {
      new LocalTransport().execFile(process.execPath, ["-e", "process.exit(3)"], {}, error =>
        resolve(error),
      );
    });

    expect(error).not.toBeNull();
    expect((error as unknown as { code: number }).code).toBe(3);
  });

  it("exit-tracks spawned processes so terminateOnOctoExit terminates them", async () =>
    withTestManager(async manager => {
      const child = new LocalTransport().execFile(
        process.execPath,
        ["-e", "setTimeout(() => {}, 30000)"],
        {},
        undefined,
      );

      await manager.terminateOnOctoExit();

      await waitFor(() => !isAlive(child.pid!));
    }));
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
