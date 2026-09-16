import { afterEach, describe, expect, it, jest } from "bun:test";
import { withMock } from "antipattern";
import * as childProcess from "child_process";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { DockerTransport, manageContainer } from "./docker.ts";
import * as logger from "../logger.ts";
import { ProcessManager, processes } from "../process-manager.ts";
import backgroundProcessTool from "../tools/tool-defs/background-process.ts";
import manageBackgroundProcessTool from "../tools/tool-defs/manage-background-process.ts";
import type { ProcessExecFileCallback } from "./transport-process.ts";

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 99999;
  kill = jest.fn(() => true);
  unref = jest.fn();

  finish(code: number) {
    this.stdout.end();
    this.stderr.end();
    this.emit("exit", code, null);
    this.emit("close", code, null);
  }
}

async function harness() {
  const manager = new ProcessManager();
  const children: FakeChild[] = [];
  const spawn = jest.spyOn(childProcess, "spawn").mockImplementation((() => {
    const child = new FakeChild();
    children.push(child);
    return child as unknown as childProcess.ChildProcess;
  }) as typeof childProcess.spawn);
  const execFile = jest.spyOn(childProcess, "execFile").mockImplementation(((
    _file: string,
    _args: string[],
    _options: childProcess.ExecFileOptions,
    callback: ProcessExecFileCallback,
  ) => {
    const child = new FakeChild();
    children.push(child);
    child.once("close", () => callback(null, "/workspace\n", ""));
    return child as unknown as childProcess.ChildProcess;
  }) as typeof childProcess.execFile);
  let transport!: DockerTransport;
  await withMock(
    processes,
    "manager",
    () => manager,
    async () => {
      const creating = DockerTransport.create({ type: "container", container: "sandbox" });
      children[0].stdout.write("/workspace\n");
      children[0].finish(0);
      transport = await creating;
    },
  );
  children.length = 0;
  spawn.mockClear();
  execFile.mockClear();
  return { manager, transport, children, spawn, execFile };
}

afterEach(() => jest.restoreAllMocks());

describe("DockerTransport", () => {
  it("reports container cleanup failures and shares concurrent cleanup requests", async () => {
    const { manager, children, execFile } = await harness();
    const logError = jest.spyOn(logger, "error").mockImplementation(() => {});
    const failure = Object.assign(new Error("Docker daemon unavailable"), { code: 1 });
    execFile.mockImplementationOnce(((
      _file: string,
      _args: string[],
      _options: childProcess.ExecFileOptions,
      callback: ProcessExecFileCallback,
    ) => {
      const child = new FakeChild();
      queueMicrotask(() => {
        callback(failure, "", "Docker daemon unavailable");
        child.finish(1);
      });
      return child as unknown as childProcess.ChildProcess;
    }) as typeof childProcess.execFile);
    await withMock(
      processes,
      "manager",
      () => manager,
      async () => {
        const starting = manageContainer(["-d", "alpine:3.21", "sleep", "30"]);
        children[0].stdout.write("test-container\n");
        children[0].finish(0);
        const container = await starting;
        await Promise.all([container.close(), container.close(), manager.runCleanups()]);
        expect(execFile).toHaveBeenCalledTimes(1);
        expect(execFile).toHaveBeenCalledWith(
          "docker",
          ["kill", "test-container"],
          expect.objectContaining({ timeout: 5000, killSignal: "SIGKILL" }),
          expect.any(Function),
        );
        expect(logError).toHaveBeenCalledWith(
          "info",
          "Failed to stop Docker container test-container:",
          failure,
        );
      },
    );
  });
  it("executes literal arguments with container env and returns UTF-8 text", async () => {
    const { transport, children, execFile } = await harness();
    const callback = jest.fn();
    const child = transport.execFile(
      "printf",
      ["%s", "$MESSAGE; echo unexpected"],
      {
        env: { MESSAGE: "container value" },
        maxBuffer: 128,
        timeout: 200,
      },
      callback,
    );

    expect(execFile).toHaveBeenCalledWith(
      "docker",
      [
        "exec",
        "-i",
        "--workdir",
        "/workspace",
        "--env",
        "MESSAGE=container value",
        "sandbox",
        "printf",
        "%s",
        "$MESSAGE; echo unexpected",
      ],
      { encoding: "utf8", maxBuffer: 128, timeout: 200 },
      callback,
    );
    children[0].finish(0);
    await child.processClosedPromise;
    expect(callback).toHaveBeenCalledTimes(1);
  });
  it("runs commands through docker exec with the requested cwd", async () => {
    const { transport, children, spawn } = await harness();
    const process = transport.spawn("printf", ["hello"], {
      cwd: "/workspace/with space",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(spawn).toHaveBeenCalledWith(
      "docker",
      ["exec", "-i", "--workdir", "/workspace/with space", "sandbox", "printf", "hello"],
      expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
    );
    children[0].stdout.write("hello");
    children[0].finish(0);
    await process.processClosedPromise;
  });

  it("supports shell commands", async () => {
    const { transport, children, spawn } = await harness();
    const controller = new AbortController();
    const output = transport.shell(controller.signal, "printf hello", 5000);
    expect(spawn).toHaveBeenCalledWith(
      "docker",
      ["exec", "-i", "--workdir", "/workspace", "sandbox", "/bin/sh", "-c", "printf hello"],
      expect.objectContaining({ detached: true }),
    );
    children[0].stdout.write("hello");
    children[0].finish(0);
    expect(await output).toBe("hello");
  });

  it("loads background tools and runs background commands in the container", async () => {
    const { transport, children, spawn } = await harness();
    const controller = new AbortController();
    const context = { signal: controller.signal, transport, data: {} as never };
    expect(await backgroundProcessTool(context)).not.toBeNull();
    expect(await manageBackgroundProcessTool(context)).not.toBeNull();
    const background = transport.backgroundProcesses.start("printf hello", "hello");
    expect(spawn).toHaveBeenCalledWith(
      "docker",
      ["exec", "-i", "--workdir", "/workspace", "sandbox", "/bin/sh", "-c", "printf hello"],
      expect.objectContaining({ detached: true }),
    );
    children[0].stdout.write("hello");
    children[0].finish(0);
    expect(background.status).toEqual({ state: "exited", code: 0, signal: null });
    expect(background.drainUnreadOutput()).toEqual({ stdout: "hello", stderr: "" });
  });

  it("passes shell commands as one command argument and creates a process group when detached", async () => {
    const { transport, spawn } = await harness();
    transport.spawn("printf hello", [], { shell: "bash", detached: true });

    expect(spawn).toHaveBeenCalledWith(
      "docker",
      ["exec", "-i", "--workdir", "/workspace", "sandbox", "bash", "-c", "printf hello"],
      expect.objectContaining({ detached: true }),
    );
  });

  it("tracks docker processes for cleanup", async () => {
    const { transport, manager, children } = await harness();
    transport.spawn("sleep", ["30"], {});
    children[0].kill.mockImplementation(() => {
      children[0].finish(137);
      return true;
    });
    await manager.terminateAll({ graceMs: 0 });
    expect(children[0].kill).toHaveBeenCalledWith("SIGKILL");
  });
});
