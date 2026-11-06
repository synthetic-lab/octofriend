import React, { useEffect } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it, mock } from "bun:test";
import type { PaintCannon } from "paintcannon";
import { AppContext } from "paintcannon-react/dist/src/hooks/use-app.js";
import { EnvironmentProvider, useEnvironment } from "./environment.tsx";
import { MockTransport } from "./transports/mock.ts";
import { CommandFailedError, type Transport } from "./libocto/transport.ts";
import { err, ok } from "./libocto/result.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const GIT_COMMAND = "git rev-parse --abbrev-ref HEAD --absolute-git-dir";
type ShellResult = Awaited<ReturnType<Transport["shell"]>>;

function createTransport(cwd = "/repo") {
  const transport: Transport = new MockTransport({ cwd });
  const requests: Array<{
    command: string;
    signal: AbortSignal;
    timeout: number;
    resolve: (result: ShellResult) => void;
  }> = [];
  const watchers: Array<{
    path: string;
    signal: AbortSignal;
    onEvent: () => void;
    close: ReturnType<typeof mock<() => Promise<void>>>;
  }> = [];
  transport.shell = (signal, command, timeout) => {
    const { promise, resolve } = Promise.withResolvers<ShellResult>();
    requests.push({ command, signal, timeout, resolve });
    return promise;
  };
  transport.watchFile = async (signal, path, onEvent) => {
    const close = mock(async () => {});
    watchers.push({ path, signal, onEvent, close });
    return ok({ close });
  };
  return { transport, requests, watchers };
}

function createHarness(initialTransport: Transport) {
  const snapshots: Array<ReturnType<typeof useEnvironment>> = [];
  const mounted = mock();
  const app = {
    paintCannon: {} as PaintCannon,
    exit: mock(),
    waitUntilExit: async () => {},
  };
  let renderer: TestRenderer.ReactTestRenderer | null = null;
  function Consumer() {
    const environment = useEnvironment();
    snapshots.push(environment);
    useEffect(() => {
      mounted();
    }, []);
    return <span>{JSON.stringify(environment)}</span>;
  }
  return {
    snapshots,
    mounted,
    exit: app.exit,
    render(transport = initialTransport, consumers = 1) {
      const tree = (
        <AppContext.Provider value={app}>
          <EnvironmentProvider transport={transport}>
            {Array.from({ length: consumers }, (_, index) => (
              <Consumer key={index} />
            ))}
          </EnvironmentProvider>
        </AppContext.Provider>
      );
      act(() => {
        if (renderer) renderer.update(tree);
        else renderer = TestRenderer.create(tree);
      });
    },
    isPending() {
      return renderer!.toJSON() == null;
    },
    unmount() {
      act(() => renderer?.unmount());
      renderer = null;
    },
  };
}

describe("EnvironmentProvider", () => {
  it("seeds branch and HOME together before mounting consumers, with one shared lookup", async () => {
    const t = createTransport("/container/project");
    const h = createHarness(t.transport);
    try {
      h.render(t.transport, 2);
      expect(t.requests.map(request => request.command)).toEqual([GIT_COMMAND, "echo $HOME"]);
      expect(t.requests.map(request => request.timeout)).toEqual([5000, 5000]);
      expect(h.isPending()).toBe(true);
      await act(async () => t.requests[1].resolve(ok("/container\n")));
      expect(h.snapshots).toEqual([]);
      await act(async () => t.requests[0].resolve(ok("main\n/container/project/.git\n")));
      expect(h.snapshots).toEqual([
        { branch: "main", home: "/container" },
        { branch: "main", home: "/container" },
      ]);
      expect(t.watchers[0].path).toBe("/container/project/.git/HEAD");
      h.render(t.transport, 3);
      expect(t.requests).toHaveLength(2);
      expect(t.watchers).toHaveLength(1);
    } finally {
      h.unmount();
    }
    expect(t.watchers[0].close).toHaveBeenCalledTimes(1);
    expect(t.requests.every(request => request.signal.aborted)).toBe(true);
  });

  it("keeps the latest branch while HOME is pending and updates it live without remounting", async () => {
    const t = createTransport();
    const h = createHarness(t.transport);
    try {
      h.render();
      await act(async () => t.requests[0].resolve(ok("main\n/repo/.git\n")));
      expect(h.snapshots).toEqual([]);
      act(() => t.watchers[0].onEvent());
      await act(async () => t.requests[2].resolve(ok("feature\n/repo/.git\n")));
      await act(async () => t.requests[1].resolve(ok("/home/test\n")));
      expect(h.snapshots[0]).toEqual({ branch: "feature", home: "/home/test" });
      act(() => t.watchers[1].onEvent());
      await act(async () => t.requests[3].resolve(ok("next\n/repo/.git\n")));
      expect(h.snapshots.at(-1)).toEqual({ branch: "next", home: "/home/test" });
      expect(h.mounted).toHaveBeenCalledTimes(1);
      expect(t.watchers[0].close).toHaveBeenCalledTimes(1);
      expect(t.requests.filter(request => request.command === "echo $HOME")).toHaveLength(1);
    } finally {
      h.unmount();
    }
  });

  it("allows missing environment data and notices a repository created later", async () => {
    const t = createTransport();
    const h = createHarness(t.transport);
    try {
      h.render();
      await act(async () => {
        t.requests[0].resolve(err(new CommandFailedError("not a git repository")));
        t.requests[1].resolve(err(new CommandFailedError("HOME unavailable")));
      });
      expect(h.snapshots[0]).toEqual({ branch: null, home: null });
      expect(h.exit).not.toHaveBeenCalled();
      expect(t.watchers[0].path).toBe("/repo/.git");
      act(() => t.watchers[0].onEvent());
      await act(async () => t.requests[2].resolve(ok("main\n/repo/.git\n")));
      expect(h.snapshots.at(-1)?.branch).toBe("main");
      expect(t.watchers[1].path).toBe("/repo/.git/HEAD");
    } finally {
      h.unmount();
    }
  });

  it("treats empty HOME and detached HEAD as valid seeded nulls", async () => {
    const t = createTransport();
    const h = createHarness(t.transport);
    try {
      h.render();
      await act(async () => {
        t.requests[0].resolve(ok("HEAD\n/repo/.git\n"));
        t.requests[1].resolve(ok("\n"));
      });
      expect(h.snapshots[0]).toEqual({ branch: null, home: null });
      expect(t.watchers[0].path).toBe("/repo/.git/HEAD");
    } finally {
      h.unmount();
    }
  });

  it("aborts pending reads on unmount and never publishes their late results", async () => {
    const t = createTransport();
    const h = createHarness(t.transport);
    h.render();
    h.unmount();
    expect(t.requests.every(request => request.signal.aborted)).toBe(true);
    await act(async () => {
      t.requests[0].resolve(ok("main\n/repo/.git\n"));
      t.requests[1].resolve(ok("/home/test\n"));
    });
    expect(h.snapshots).toEqual([]);
    expect(t.watchers).toEqual([]);
    expect(h.exit).not.toHaveBeenCalled();
  });

  it("hides the old seed when switching transports and ignores stale refreshes", async () => {
    const first = createTransport();
    const second = createTransport("/other");
    const h = createHarness(first.transport);
    try {
      h.render();
      await act(async () => {
        first.requests[0].resolve(ok("main\n/repo/.git\n"));
        first.requests[1].resolve(ok("/home/first\n"));
      });
      act(() => first.watchers[0].onEvent());
      h.render(second.transport);
      expect(h.isPending()).toBe(true);
      expect(first.watchers[0].close).toHaveBeenCalledTimes(1);
      await act(async () => first.requests[2].resolve(ok("stale\n/repo/.git\n")));
      expect(h.isPending()).toBe(true);
      await act(async () => {
        second.requests[0].resolve(ok("other\n/other/.git\n"));
        second.requests[1].resolve(ok("/home/second\n"));
      });
      expect(h.snapshots.at(-1)).toEqual({ branch: "other", home: "/home/second" });
      expect(h.snapshots.some(snapshot => snapshot.branch === "stale")).toBe(false);
    } finally {
      h.unmount();
    }
  });
});
