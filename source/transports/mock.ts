import { EventEmitter } from "events";
import { PassThrough } from "stream";
import type { ExecFileException } from "child_process";
import type { Transport } from "./transport-common.ts";
import {
  type TransportExecFileCallback,
  type TransportExecFileOptions,
  type TransportProcess,
  type TransportProcessEvents,
  type TransportSpawnOptions,
} from "./transport-process.ts";

export type MockProcessCall = {
  command: string;
  args: readonly string[];
  options: TransportSpawnOptions | TransportExecFileOptions;
  process: MockTransportProcess;
};

export class MockTransportProcess
  extends EventEmitter<TransportProcessEvents>
  implements TransportProcess
{
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly processClosedPromise: Promise<void>;
  readonly pid = Math.floor(Math.random() * 1_000_000) + 1;
  private closedResolve!: () => void;
  private isClosed = false;

  constructor() {
    super();
    this.processClosedPromise = new Promise(resolve => {
      this.closedResolve = resolve;
    });
  }

  kill(signal: NodeJS.Signals | number = "SIGTERM"): boolean {
    if (this.isClosed) return false;
    this.finish(null, typeof signal === "string" ? signal : null);
    return true;
  }

  unref(): void {}

  async terminate(): Promise<void> {
    this.kill("SIGTERM");
    await this.processClosedPromise;
  }

  finish(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.emit("exit", code, signal);
    this.stdin.end();
    this.stdout.end();
    this.stderr.end();
    this.emit("close", code, signal);
    this.closedResolve();
  }
}

export class MockTransport implements Transport {
  cwd: string;
  readonly spawnCalls: MockProcessCall[] = [];
  readonly execFileCalls: MockProcessCall[] = [];
  private readonly files: Record<string, string>;
  private readonly modTimes = new Map<string, number>();
  private readonly shellResult: string | ((command: string) => string | Promise<string>);

  constructor(
    options: {
      cwd?: string;
      files?: Record<string, string>;
      shellResult?: string | ((command: string) => string | Promise<string>);
    } = {},
  ) {
    this.cwd = options.cwd ?? "/repo";
    this.files = {};
    for (const [file, contents] of Object.entries(options.files ?? {})) {
      const resolved = this.resolve(file);
      this.files[resolved] = contents;
      this.modTimes.set(resolved, this.modTimes.size + 1);
    }
    this.shellResult = options.shellResult ?? "";
  }

  spawn(command: string, options?: TransportSpawnOptions): MockTransportProcess;
  spawn(
    command: string,
    args: readonly string[],
    options?: TransportSpawnOptions,
  ): MockTransportProcess;
  spawn(
    command: string,
    argsOrOptions?: readonly string[] | TransportSpawnOptions,
    maybeOptions: TransportSpawnOptions = {},
  ): MockTransportProcess {
    const args = Array.isArray(argsOrOptions) ? argsOrOptions : [];
    const options = (
      Array.isArray(argsOrOptions) ? maybeOptions : (argsOrOptions ?? {})
    ) as TransportSpawnOptions;
    const process = new MockTransportProcess();
    this.spawnCalls.push({ command, args, options, process });
    return process;
  }

  execFile(file: string, callback?: TransportExecFileCallback): MockTransportProcess;
  execFile(
    file: string,
    args: readonly string[],
    callback?: TransportExecFileCallback,
  ): MockTransportProcess;
  execFile(
    file: string,
    options?: TransportExecFileOptions,
    callback?: TransportExecFileCallback,
  ): MockTransportProcess;
  execFile(
    file: string,
    args: readonly string[],
    options?: TransportExecFileOptions,
    callback?: TransportExecFileCallback,
  ): MockTransportProcess;
  execFile(
    file: string,
    argsOrOptionsOrCallback?:
      | readonly string[]
      | TransportExecFileOptions
      | TransportExecFileCallback,
    optionsOrCallback?: TransportExecFileOptions | TransportExecFileCallback,
    maybeCallback?: TransportExecFileCallback,
  ): MockTransportProcess {
    const hasArgs = Array.isArray(argsOrOptionsOrCallback);
    const args = (hasArgs ? argsOrOptionsOrCallback : []) as readonly string[];
    const optionsArg = hasArgs ? optionsOrCallback : argsOrOptionsOrCallback;
    const callback = (
      typeof optionsArg === "function" ? optionsArg : hasArgs ? maybeCallback : optionsOrCallback
    ) as TransportExecFileCallback | undefined;
    const options = (
      typeof optionsArg === "function" ? {} : (optionsArg ?? {})
    ) as TransportExecFileOptions;
    const process = this.spawn(file, args, options);
    const call = this.spawnCalls.pop()!;
    this.execFileCalls.push({ ...call, process });
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
