import { EventEmitter } from "events";
import { PassThrough } from "stream";
import type { ChildProcess, ExecFileException } from "child_process";
import type { Transport } from "./transport-common.ts";
import { BackgroundProcessManager } from "../background-process.ts";
import {
  type ProcessExecFileCallback,
  type ProcessExecFileOptions,
  TransportProcess,
  type TransportProcessEvents,
  type ProcessSpawnOptions,
} from "./transport-process.ts";

export type MockProcessCall = {
  command: string;
  args: readonly string[];
  options: ProcessSpawnOptions | ProcessExecFileOptions;
  process: MockTransportProcess;
};

class MockChildProcess extends EventEmitter<TransportProcessEvents> {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = Math.floor(Math.random() * 1_000_000) + 1;
  private isClosed = false;

  kill(signal?: NodeJS.Signals | number): boolean {
    if (this.isClosed) return false;
    this.finish(null, typeof signal === "string" ? signal : null);
    return true;
  }

  unref(): void {}

  finish(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.emit("exit", code, signal);
    this.stdin.end();
    this.stdout.end();
    this.stderr.end();
    this.emit("close", code, signal);
  }
}

export class MockTransportProcess extends TransportProcess {
  declare readonly stdin: PassThrough;
  declare readonly stdout: PassThrough;
  declare readonly stderr: PassThrough;
  private readonly mockChild: MockChildProcess;

  constructor() {
    const child = new MockChildProcess();
    // The test double implements only the ChildProcess behavior exercised by TransportProcess.
    super(child as unknown as ChildProcess, {});
    this.mockChild = child;
  }

  finish(code: number | null, signal: NodeJS.Signals | null): void {
    this.mockChild.finish(code, signal);
  }
}

export class MockTransport implements Transport {
  cwd: string;
  readonly commandShell = "bash";
  readonly backgroundProcesses: BackgroundProcessManager;
  readonly spawnCalls: MockProcessCall[] = [];
  readonly execFileCalls: MockProcessCall[] = [];
  private readonly files: Record<string, string>;
  private readonly modTimes = new Map<string, number>();
  private readonly shellResult: string | ((command: string) => string | Promise<string>);

  constructor(options: {
    cwd?: string;
    files?: Record<string, string>;
    shellResult?: string | ((command: string) => string | Promise<string>);
  }) {
    this.cwd = options.cwd ?? "/repo";
    this.backgroundProcesses = new BackgroundProcessManager(this);
    this.files = {};
    for (const [file, contents] of Object.entries(options.files ?? {})) {
      const resolved = this.resolve(file);
      this.files[resolved] = contents;
      this.modTimes.set(resolved, this.modTimes.size + 1);
    }
    this.shellResult = options.shellResult ?? "";
  }

  spawn(
    command: string,
    args: readonly string[],
    options: ProcessSpawnOptions,
  ): MockTransportProcess {
    const process = new MockTransportProcess();
    this.spawnCalls.push({ command, args, options, process });
    return process;
  }

  execFile(
    file: string,
    args: readonly string[],
    options: ProcessExecFileOptions,
    callback: ProcessExecFileCallback | undefined,
  ): MockTransportProcess {
    const process = new MockTransportProcess();
    this.execFileCalls.push({ command: file, args, options, process });
    if (callback) {
      process.once("close", (code, signal) => {
        const error =
          code === 0 && signal == null
            ? null
            : (Object.assign(new Error("Mock process failed"), {
                code: code ?? undefined,
                signal: signal ?? undefined,
              }) as ExecFileException);
        callback(error, "", "");
      });
    }
    return process;
  }

  async writeFile(_: AbortSignal, file: string, contents: string): Promise<void> {
    const resolved = this.resolve(file);
    this.files[resolved] = contents;
    this.modTimes.set(resolved, (this.modTimes.get(resolved) ?? 0) + 1);
  }

  async readFile(_: AbortSignal, file: string): Promise<string> {
    const contents = this.files[this.resolve(file)];
    if (contents == null) throw new Error(`No such file: ${file}`);
    return contents;
  }

  async pathExists(_: AbortSignal, file: string): Promise<boolean> {
    return this.files[this.resolve(file)] != null;
  }

  async isDirectory(): Promise<boolean> {
    return false;
  }

  async mkdir(): Promise<void> {}

  async readdir(): Promise<Array<{ entry: string; isDirectory: boolean }>> {
    return [];
  }

  async modTime(_: AbortSignal, file: string): Promise<number> {
    const modTime = this.modTimes.get(this.resolve(file));
    if (modTime == null) throw new Error(`No such file: ${file}`);
    return modTime;
  }

  async resolvePath(_: AbortSignal, file: string): Promise<string> {
    return this.resolve(file);
  }

  async shell(_: AbortSignal, command: string): Promise<string> {
    return typeof this.shellResult === "function"
      ? await this.shellResult(command)
      : this.shellResult;
  }

  async close(): Promise<void> {}

  private resolve(file: string): string {
    return file.startsWith("/") ? file : `${this.cwd}/${file}`;
  }
}
