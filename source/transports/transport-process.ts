import type { ChildProcess, ExecFileException, StdioOptions } from "child_process";
import { EventEmitter } from "events";
import type { Readable, Writable } from "stream";
import type { TerminateOptions } from "../process-manager.ts";

export type TransportSpawnOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  shell?: string | boolean;
  stdio?: StdioOptions;
  detached?: boolean;
  timeout?: number;
  killSignal?: NodeJS.Signals | number;
  surviveAfterOctoExit?: boolean;
};

export type TransportExecFileOptions = {
  env?: NodeJS.ProcessEnv;
  shell?: string | boolean;
  timeout?: number;
  maxBuffer?: number;
  encoding?: BufferEncoding | "buffer" | null;
  surviveAfterOctoExit?: boolean;
};
export type TransportExecFileCallback = (
  error: ExecFileException | null,
  stdout: string | Buffer,
  stderr: string | Buffer,
) => void;

export type TransportProcessEvents = {
  error: [error: Error];
  spawn: [];
  exit: [code: number | null, signal: NodeJS.Signals | null];
  close: [code: number | null, signal: NodeJS.Signals | null];
};

export interface TransportProcess extends EventEmitter<TransportProcessEvents> {
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  readonly processClosedPromise: Promise<void>;
  readonly pid: number | undefined;
  kill(signal?: NodeJS.Signals | number): boolean | Promise<boolean>;
  unref(): void;
  terminate(options?: TerminateOptions): Promise<void>;
}

export class ChildTransportProcess
  extends EventEmitter<TransportProcessEvents>
  implements TransportProcess
{
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  readonly processClosedPromise: Promise<void>;
  private readonly processClosed: Promise<void>;
  private finished = false;
  private termination?: Promise<void>;
  private escalationTimer?: ReturnType<typeof setTimeout>;
  private finishEscalation?: () => void;

  constructor(
    private readonly childProcess: ChildProcess,
    private readonly options: { detached?: boolean } = {},
    private readonly signalProcess?: (signal: NodeJS.Signals | number) => Promise<boolean>,
    stderr: Readable | null = childProcess.stderr,
  ) {
    super();
    this.stdin = childProcess.stdin;
    this.stdout = childProcess.stdout;
    this.stderr = stderr;
    this.processClosed = new Promise(resolve => {
      childProcess.once("close", () => {
        this.finished = true;
        resolve();
      });
    });
    this.processClosedPromise = this.processClosed.then(async () => {
      let termination: Promise<void> | undefined;
      do {
        termination = this.termination;
        await termination;
      } while (termination !== this.termination);
    });
    childProcess.on("error", error => this.emit("error", error));
    childProcess.on("spawn", () => this.emit("spawn"));
    childProcess.on("exit", (code, signal) => this.emit("exit", code, signal));
    childProcess.on("close", (code, signal) => this.emit("close", code, signal));
  }

  get pid(): number | undefined {
    return this.childProcess.pid;
  }

  kill(signal: NodeJS.Signals | number = "SIGTERM"): boolean | Promise<boolean> {
    if (this.signalProcess) return this.signalProcess(signal);
    if (this.options.detached && this.pid != null) {
      try {
        return process.kill(-this.pid, signal);
      } catch {}
    }
    if (this.finished) return false;
    try {
      return this.childProcess.kill(signal);
    } catch {
      return false;
    }
  }

  unref(): void {
    this.childProcess.unref();
  }

  terminate(options: TerminateOptions = {}): Promise<void> {
    if (this.finished && !this.termination) return this.processClosedPromise;
    if (options.graceMs === 0) {
      clearTimeout(this.escalationTimer);
      this.finishEscalation?.();
      this.termination = this.sendSignal("SIGKILL").then(() => this.processClosed);
      return this.termination;
    }
    if (this.termination) return this.termination;
    const signaled = this.sendSignal("SIGTERM");
    const escalated = new Promise<void>(resolve => {
      this.finishEscalation = resolve;
      this.escalationTimer = setTimeout(() => {
        void this.sendSignal("SIGKILL").then(resolve);
      }, options.graceMs ?? 1000);
      if (!this.options.detached) this.escalationTimer.unref();
    });
    this.termination = Promise.all([
      signaled,
      this.processClosed,
      this.options.detached ? escalated : Promise.resolve(),
    ]).then(() => {
      clearTimeout(this.escalationTimer);
      this.finishEscalation?.();
    });
    return this.termination;
  }

  private async sendSignal(signal: NodeJS.Signals): Promise<void> {
    try {
      await this.kill(signal);
    } catch {}
  }
}

export function spawnArguments(
  argsOrOptions?: readonly string[] | TransportSpawnOptions,
  maybeOptions: TransportSpawnOptions = {},
): { args: readonly string[]; options: TransportSpawnOptions } {
  if (Array.isArray(argsOrOptions)) return { args: argsOrOptions, options: maybeOptions };
  return { args: [], options: (argsOrOptions as TransportSpawnOptions | undefined) ?? {} };
}

export function execFileArguments(
  argsOrOptionsOrCallback?:
    | readonly string[]
    | TransportExecFileOptions
    | TransportExecFileCallback,
  optionsOrCallback?: TransportExecFileOptions | TransportExecFileCallback,
  maybeCallback?: TransportExecFileCallback,
): {
  args: readonly string[];
  options: TransportExecFileOptions;
  callback?: TransportExecFileCallback;
} {
  const hasArgs = Array.isArray(argsOrOptionsOrCallback);
  const args = (hasArgs ? argsOrOptionsOrCallback : []) as readonly string[];
  const optionsArg = hasArgs ? optionsOrCallback : argsOrOptionsOrCallback;
  const callbackArg = hasArgs ? maybeCallback : optionsOrCallback;
  return {
    args,
    options: (typeof optionsArg === "function"
      ? {}
      : (optionsArg ?? {})) as TransportExecFileOptions,
    callback: (typeof optionsArg === "function" ? optionsArg : callbackArg) as
      | TransportExecFileCallback
      | undefined,
  };
}

export function collectExecFileOutput(
  execProcess: TransportProcess,
  file: string,
  args: readonly string[],
  options: TransportExecFileOptions,
  callback?: TransportExecFileCallback,
): void {
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  const lengths = { stdout: 0, stderr: 0 };
  const maxBuffer = options.maxBuffer ?? 1024 * 1024;
  let error: ExecFileException | null = null;
  const append = (stream: "stdout" | "stderr", chunk: Buffer | string) => {
    if (error) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = Math.max(0, maxBuffer - lengths[stream]);
    (stream === "stdout" ? stdout : stderr).push(buffer.subarray(0, remaining));
    lengths[stream] += buffer.length;
    if (lengths[stream] > maxBuffer) {
      error = Object.assign(new RangeError(`${stream} maxBuffer length exceeded`), {
        code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      }) as ExecFileException;
      void execProcess.terminate({ graceMs: 0 });
    }
  };
  execProcess.stdout?.on("data", chunk => append("stdout", chunk));
  execProcess.stderr?.on("data", chunk => append("stderr", chunk));
  execProcess.on("error", err => {
    error ??= err;
  });
  execProcess.once("close", (code, signal) => {
    const encoding = options.encoding === undefined ? "utf8" : options.encoding;
    const stdoutBuffer = Buffer.concat(stdout);
    const stderrBuffer = Buffer.concat(stderr);
    const out =
      encoding == null || encoding === "buffer"
        ? stdoutBuffer
        : stdoutBuffer.toString(encoding as BufferEncoding);
    const err =
      encoding == null || encoding === "buffer"
        ? stderrBuffer
        : stderrBuffer.toString(encoding as BufferEncoding);
    if (!error && (code !== 0 || signal !== null)) {
      error = Object.assign(new Error(`Command failed: ${[file, ...args].join(" ")}\n${err}`), {
        code: code ?? undefined,
        signal: signal ?? undefined,
      });
    }
    callback?.(error, out, err);
  });
}
