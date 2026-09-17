import { afterEach, describe, expect, it, jest } from "bun:test";
import { EventEmitter } from "events";
import { ProcessManager } from "./process-manager.ts";
import { MockTransportProcess } from "./transports/mock.ts";

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("ProcessManager", () => {
  it("runs cleanup callbacks without a local child process", async () => {
    const manager = new ProcessManager();
    const kill = jest.fn(async () => {});
    manager.registerOctoExitCleanup(kill);

    await manager.terminateOnOctoExit();

    expect(kill).toHaveBeenCalledWith({});
  });

  it("waits for asynchronous termination and tolerates failed callbacks", async () => {
    const manager = new ProcessManager();
    const killed = Promise.withResolvers<void>();
    manager.registerOctoExitCleanup(async () => {
      throw new Error("unreachable target");
    });
    const kill = jest.fn(() => killed.promise);
    manager.registerOctoExitCleanup(kill);
    let finished = false;
    const termination = manager.terminateOnOctoExit().then(() => {
      finished = true;
    });
    await Promise.resolve();

    expect(kill).toHaveBeenCalledTimes(1);
    expect(finished).toBe(false);
    killed.resolve();
    await termination;
    expect(finished).toBe(true);
  });

  it("prunes completed processes", async () => {
    const manager = new ProcessManager();
    const tracked = new MockTransportProcess();
    const terminate = jest.spyOn(tracked, "terminate");
    manager.register(tracked);
    tracked.finish(0, null);
    await tracked.processClosedPromise;

    await manager.terminateOnOctoExit();

    expect(terminate).not.toHaveBeenCalled();
  });

  it("can unregister a process explicitly", async () => {
    const manager = new ProcessManager();
    const kill = jest.fn(async () => {});
    const unregister = manager.registerOctoExitCleanup(kill);
    unregister();
    unregister();

    await manager.terminateOnOctoExit();
    expect(kill).not.toHaveBeenCalled();
  });

  it("isolates registrations between managers", async () => {
    const here = new ProcessManager();
    const there = new ProcessManager();
    const kill = jest.fn(async () => {});
    there.registerOctoExitCleanup(kill);

    await here.terminateOnOctoExit();
    expect(kill).not.toHaveBeenCalled();
  });

  it("preserves exit survivors", async () => {
    const manager = new ProcessManager();
    const survivor = new MockTransportProcess({ surviveAfterOctoExit: true });
    const terminate = jest.spyOn(survivor, "terminate");
    manager.register(survivor);

    await manager.terminateOnOctoExit();
    expect(terminate).not.toHaveBeenCalled();
  });
});

describe("ProcessManager.terminateOnOctoExit", () => {
  it("runs cleanups once and terminates remaining processes after cleanup failures", async () => {
    const manager = new ProcessManager();
    const calls: string[] = [];
    manager.registerOctoExitCleanup(async () => {
      calls.push("sync");
    });
    manager.registerOctoExitCleanup(async () => {
      calls.push("async");
    });
    manager.registerOctoExitCleanup(async () => {
      throw new Error("cleanup failed");
    });
    manager.registerOctoExitCleanup(async () => {
      calls.push("kill");
    });

    await manager.terminateOnOctoExit();
    await manager.terminateOnOctoExit();

    expect(calls).toEqual(["sync", "async", "kill"]);
  });

  it("shares in-progress shutdown with concurrent callers", async () => {
    const manager = new ProcessManager();
    const cleaned = Promise.withResolvers<void>();
    const cleanup = jest.fn(() => cleaned.promise);
    manager.registerOctoExitCleanup(cleanup);

    const first = manager.terminateOnOctoExit();
    const second = manager.terminateOnOctoExit();
    expect(first).toBe(second);
    cleaned.resolve();
    await Promise.all([first, second]);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("does not run unregistered cleanups or another manager's cleanups", async () => {
    const manager = new ProcessManager();
    const cleanup = jest.fn(async () => {});
    const unregister = manager.registerOctoExitCleanup(cleanup);
    unregister();
    unregister();
    new ProcessManager().registerOctoExitCleanup(cleanup);

    await manager.terminateOnOctoExit();
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("still terminates processes when a cleanup hangs", async () => {
    jest.useFakeTimers();
    const manager = new ProcessManager();
    manager.registerOctoExitCleanup(() => new Promise(() => {}));
    const kill = jest.fn(async () => {});
    manager.registerOctoExitCleanup(kill);

    const cleanup = manager.terminateOnOctoExit();
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
      const tracked = new MockTransportProcess();
      const survivor = new MockTransportProcess({ surviveAfterOctoExit: true });
      const kill = jest.spyOn(tracked, "terminate");
      const survive = jest.spyOn(survivor, "terminate");
      manager.register(tracked);
      manager.register(survivor);
      handlers.get("exit")!();

      expect(kill).toHaveBeenCalledWith({ graceMs: 0 });
      expect(survive).not.toHaveBeenCalled();
    });
  });

  it("waits for cleanup before re-raising a signal and falls back to conventional exit codes", async () => {
    jest.useFakeTimers();
    const kill = jest.spyOn(process, "kill").mockImplementation(() => true);
    const exit = jest.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await withSignalHandlers(async (manager, handlers) => {
      const cleaned = Promise.withResolvers<void>();
      const cleanup = jest.fn(() => cleaned.promise);
      manager.registerOctoExitCleanup(cleanup);
      handlers.get("SIGTERM")!();
      handlers.get("SIGINT")!();

      expect(kill).not.toHaveBeenCalled();
      cleaned.resolve();
      await manager.terminateOnOctoExit();
      await Promise.resolve();

      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(kill).toHaveBeenCalledWith(process.pid, "SIGTERM");
      jest.advanceTimersByTime(1000);
      expect(exit).toHaveBeenCalledWith(143);
    });
  });
});
