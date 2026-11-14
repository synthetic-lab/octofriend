import { EventEmitter } from "events";
import { PassThrough } from "stream";
import type { ChildProcess, ExecFileException } from "child_process";
import {
  TransportProcess,
  createPollingFileWatcher,
  err,
  ok,
  runBackgroundShell,
  type BackgroundShellOptions,
  type FsWatcher,
  type ProcessExecFileCallback,
  type ProcessExecFileOptions,
  type ProcessSpawnOptions,
  type Result,
  type Transport,
  type TransportError,
  type TransportProcessEvents,
  type TransportProcessOptions,
} from "../libocto/index.ts";

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

  constructor(options: TransportProcessOptions = {}) {
    const child = new MockChildProcess();
    // The test double implements only the ChildProcess behavior exercised by TransportProcess.
    super(child as unknown as ChildProcess, options);
    this.mockChild = child;
  }

  finish(code: number | null, signal: NodeJS.Signals | null): void {
    this.mockChild.finish(code, signal);
  }
}

export class MockTransport implements Transport {
  cwd: string;
  readonly commandShell = "bash";
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

  async writeFile(_: AbortSignal, file: string, contents: string): Promise<Result<null, string>> {
    const resolved = this.resolve(file);
    this.files[resolved] = contents;
    this.modTimes.set(resolved, (this.modTimes.get(resolved) ?? 0) + 1);
    return ok(null);
  }

  async readFile(_: AbortSignal, file: string): Promise<Result<string, string>> {
    const contents = this.files[this.resolve(file)];
    if (contents == null) return err(`No such file: ${file}`);
    return ok(contents);
  }

  async pathExists(_: AbortSignal, file: string): Promise<Result<boolean, string>> {
    return ok(this.files[this.resolve(file)] != null);
  }

  async isDirectory(): Promise<Result<boolean, string>> {
    return ok(false);
  }

  async mkdir(): Promise<Result<null, string>> {
    return ok(null);
  }

  async readdir(): Promise<Result<Array<{ entry: string; isDirectory: boolean }>, string>> {
    return ok([]);
  }

  async modTime(_: AbortSignal, file: string): Promise<Result<number, string>> {
    const modTime = this.modTimes.get(this.resolve(file));
    if (modTime == null) return err(`No such file: ${file}`);
    return ok(modTime);
  }

  async resolvePath(_: AbortSignal, file: string): Promise<Result<string, string>> {
    return ok(this.resolve(file));
  }

  backgroundShell(options: BackgroundShellOptions) {
    return runBackgroundShell(this, options);
  }

  async watchFile(
    signal: AbortSignal,
    file: string,
    onEvent: () => void,
  ): Promise<Result<FsWatcher, string>> {
    return ok(createPollingFileWatcher(this, signal, file, onEvent));
  }

  async shell(_: AbortSignal, command: string): Promise<Result<string, TransportError>> {
    return ok(
      typeof this.shellResult === "function" ? await this.shellResult(command) : this.shellResult,
    );
  }

  async close(): Promise<void> {}

  private resolve(file: string): string {
    return file.startsWith("/") ? file : `${this.cwd}/${file}`;
  }
}
