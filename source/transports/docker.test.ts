import { afterEach, describe, expect, it, jest } from "bun:test";
import * as childProcess from "child_process";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { DockerTransport } from "./docker.ts";
import { ProcessManager } from "../process-manager.ts";
import { BackgroundProcessManager } from "../background-process.ts";

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 99999;
  kill = jest.fn(() => true);
  unref = jest.fn();

  finish(code = 0) {
    this.stdout.end();
    this.stderr.end();
    this.emit("exit", code, null);
    this.emit("close", code, null);
  }
}

function harness() {
  const manager = new ProcessManager();
  const transport = Reflect.construct(DockerTransport, [
    { type: "container", container: "sandbox" },
    "/workspace",
    manager,
  ]) as DockerTransport;
  const children: FakeChild[] = [];
  const spawn = jest.spyOn(childProcess, "spawn").mockImplementation((() => {
    const child = new FakeChild();
    children.push(child);
    return child as unknown as childProcess.ChildProcess;
  }) as typeof childProcess.spawn);
  return { manager, transport, children, spawn };
}

afterEach(() => jest.restoreAllMocks());

describe("DockerTransport", () => {
  it("runs commands through docker exec with the requested cwd", async () => {
    const { transport, children, spawn } = harness();
    const process = transport.spawn("printf", ["hello"], {
      cwd: "/workspace/with space",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(spawn).toHaveBeenCalledWith(
      "docker",
      [
        "exec",
        "-i",
        "--workdir",
        "/workspace/with space",
        "sandbox",
        "/bin/sh",
        "-c",
        "printf hello",
      ],
      expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
    );
    children[0].stdout.write("hello");
    children[0].finish();
    await process.processClosedPromise;
  });

  it("supports shell commands and background processes", async () => {
    const { transport, children } = harness();
    const manager = new BackgroundProcessManager(transport);
    const background = manager.start("printf hello", "hello");
    children[0].stdout.write("hello");
    children[0].finish();
    expect(background.status).toEqual({ state: "exited", code: 0, signal: null });
    expect(background.drainUnreadOutput()).toEqual({ stdout: "hello", stderr: "" });
  });

  it("tracks docker processes for cleanup", async () => {
    const { transport, manager, children } = harness();
    transport.spawn("sleep", ["30"]);
    children[0].kill.mockImplementation(() => {
      children[0].finish(137);
      return true;
    });
    await manager.terminateAll({ graceMs: 0 });
    expect(children[0].kill).toHaveBeenCalledWith("SIGKILL");
  });
});
