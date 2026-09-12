import { afterEach, describe, expect, it, jest } from "bun:test";
import { EventEmitter } from "events";
import { ProcessManager } from "./process-manager.ts";

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("ProcessManager.register", () => {
  it("tracks termination callbacks without a local child process", async () => {
    const manager = new ProcessManager();
    const kill = jest.fn(async () => {});
    manager.register({ cleanup: kill, processClosedPromise: new Promise(() => {}) });

    await manager.terminateAll({ graceMs: 100 });

    expect(kill).toHaveBeenCalledWith({ graceMs: 100 });
  });

  it("waits for asynchronous termination and tolerates failed callbacks", async () => {
    const manager = new ProcessManager();
    const killed = Promise.withResolvers<void>();
    manager.register({
      cleanup: () => {
        throw new Error("unreachable target");
      },
      processClosedPromise: new Promise(() => {}),
    });
    const kill = jest.fn(() => killed.promise);
    manager.register({ cleanup: kill, processClosedPromise: new Promise(() => {}) });
    let finished = false;
    const termination = manager.terminateAll().then(() => {
      finished = true;
    });
    await Promise.resolve();

    expect(kill).toHaveBeenCalledTimes(1);
    expect(finished).toBe(false);
    killed.resolve();
    await termination;
    expect(finished).toBe(true);
  });

  it.each([false, true])("prunes completed registrations, rejected: %s", async rejected => {
    const manager = new ProcessManager();
    const closed = Promise.withResolvers<void>();
    const kill = jest.fn();
    manager.register({ cleanup: kill, processClosedPromise: closed.promise });
    if (rejected) closed.reject(new Error("connection closed"));
    else closed.resolve();
    await Promise.resolve();

    await manager.terminateAll();
    await manager.runCleanups();

    expect(kill).not.toHaveBeenCalled();
  });

  it("can unregister a process explicitly", async () => {
    const manager = new ProcessManager();
    const kill = jest.fn();
    const unregister = manager.register({
      cleanup: kill,
      processClosedPromise: new Promise(() => {}),
    });
    unregister();
    unregister();

    await manager.terminateAll();
    expect(kill).not.toHaveBeenCalled();
  });

  it("isolates registrations between managers", async () => {
    const here = new ProcessManager();
    const there = new ProcessManager();
    const kill = jest.fn();
    there.register({ cleanup: kill, processClosedPromise: new Promise(() => {}) });

    await here.terminateAll();
    await here.runCleanups();
    expect(kill).not.toHaveBeenCalled();
  });

  it("preserves exit survivors but supports terminating them explicitly", async () => {
    const manager = new ProcessManager();
    const kill = jest.fn();
    manager.register({
      cleanup: kill,
      processClosedPromise: new Promise(() => {}),
      surviveAfterOctoExit: true,
    });

    await manager.runCleanups();
    expect(kill).not.toHaveBeenCalled();
    await manager.terminateAll();
    expect(kill).toHaveBeenCalledTimes(1);
  });
});

describe("ProcessManager.runCleanups", () => {
  it("runs cleanups once and terminates remaining processes after cleanup failures", async () => {
    const manager = new ProcessManager();
    const calls: string[] = [];
    manager.register({
      cleanup: () => {
        calls.push("sync");
      },
      processClosedPromise: new Promise(() => {}),
    });
    manager.register({
      cleanup: async () => {
        calls.push("async");
      },
      processClosedPromise: new Promise(() => {}),
    });
    manager.register({
      cleanup: () => {
        throw new Error("cleanup failed");
      },
      processClosedPromise: new Promise(() => {}),
    });
    manager.register({
      cleanup: () => {
        calls.push("kill");
      },
      processClosedPromise: new Promise(() => {}),
    });

    await manager.runCleanups();
    await manager.runCleanups();

    expect(calls).toEqual(["sync", "async", "kill"]);
  });

  it("shares in-progress shutdown with concurrent callers", async () => {
    const manager = new ProcessManager();
    const cleaned = Promise.withResolvers<void>();
    const cleanup = jest.fn(() => cleaned.promise);
    manager.register({ cleanup, processClosedPromise: new Promise(() => {}) });

    const first = manager.runCleanups();
    const second = manager.runCleanups();
    expect(first).toBe(second);
    cleaned.resolve();
    await Promise.all([first, second]);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("does not run unregistered cleanups or another manager's cleanups", async () => {
    const manager = new ProcessManager();
    const cleanup = jest.fn();
    const unregister = manager.register({ cleanup, processClosedPromise: new Promise(() => {}) });
    unregister();
    unregister();
    new ProcessManager().register({ cleanup, processClosedPromise: new Promise(() => {}) });

    await manager.runCleanups();
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("still terminates processes when a cleanup hangs", async () => {
    jest.useFakeTimers();
    const manager = new ProcessManager();
    manager.register({
      cleanup: () => new Promise(() => {}),
      processClosedPromise: new Promise(() => {}),
    });
    const kill = jest.fn();
    manager.register({ cleanup: kill, processClosedPromise: new Promise(() => {}) });

    const cleanup = manager.runCleanups();
    jest.advanceTimersByTime(5000);
    await cleanup;

    expect(kill).toHaveBeenCalledTimes(1);
  });
});

describe("ProcessManager.installGlobalProcessSignalHandlers", () => {
  const events = ["SIGINT", "SIGTERM", "SIGHUP", "exit"];
  const emitter: EventEmitter = process;
  const listeners = (event: string) => emitter.listeners(event) as ((...args: any[]) => void)[];

  async function withSignalHandlers(
    run: (
      manager: ProcessManager,
      handlers: Map<string, (...args: any[]) => void>,
    ) => Promise<void>,
  ) {
    const before = new Map(events.map(event => [event, listeners(event)]));
    const manager = new ProcessManager();
    try {
      manager.installGlobalProcessSignalHandlers();
      manager.installGlobalProcessSignalHandlers();
      const handlers = new Map(
        events.map(event => {
          expect(emitter.listenerCount(event)).toBe(before.get(event)!.length + 1);
          return [
            event,
            listeners(event).find(listener => !before.get(event)!.includes(listener))!,
          ];
        }),
      );
      await run(manager, handlers);
    } finally {
      for (const event of events) {
        for (const listener of listeners(event)) {
          if (!before.get(event)!.includes(listener)) emitter.removeListener(event, listener);
        }
      }
    }
  }

  it("invokes forced termination synchronously on exit, skipping survivors", async () => {
    await withSignalHandlers(async (manager, handlers) => {
      const kill = jest.fn();
      const survivor = jest.fn();
      manager.register({ cleanup: kill, processClosedPromise: new Promise(() => {}) });
      manager.register({
        cleanup: survivor,
        processClosedPromise: new Promise(() => {}),
        surviveAfterOctoExit: true,
      });
      handlers.get("exit")!();

      expect(kill).toHaveBeenCalledWith({ graceMs: 0 });
      expect(survivor).not.toHaveBeenCalled();
    });
  });

  it("waits for cleanup before re-raising a signal and falls back to conventional exit codes", async () => {
    jest.useFakeTimers();
    const kill = jest.spyOn(process, "kill").mockImplementation(() => true);
    const exit = jest.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await withSignalHandlers(async (manager, handlers) => {
      const cleaned = Promise.withResolvers<void>();
      const cleanup = jest.fn(() => cleaned.promise);
      manager.register({ cleanup, processClosedPromise: new Promise(() => {}) });
      handlers.get("SIGTERM")!();
      handlers.get("SIGINT")!();

      expect(kill).not.toHaveBeenCalled();
      cleaned.resolve();
      await manager.runCleanups();
      await Promise.resolve();

      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(kill).toHaveBeenCalledWith(process.pid, "SIGTERM");
      jest.advanceTimersByTime(1000);
      expect(exit).toHaveBeenCalledWith(143);
    });
  });
});
