import type { ChildProcess, ExecFileException, StdioOptions } from "child_process";
import { EventEmitter } from "events";
import type { Readable, Writable } from "stream";

export type ProcessSpawnOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: StdioOptions;
  detached?: boolean;
  timeout?: number;
  surviveAfterOctoExit?: boolean;
};

export type ProcessExecFileOptions = {
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  maxBuffer?: number;
};
export type ProcessExecFileCallback = (
  error: ExecFileException | null,
  stdout: string,
  stderr: string,
) => void;

export type TransportProcessEvents = {
  error: [error: Error];
  spawn: [];
  exit: [code: number | null, signal: NodeJS.Signals | null];
  close: [code: number | null, signal: NodeJS.Signals | null];
};

export type TransportProcessOptions = {
  detached?: boolean;
  surviveAfterOctoExit?: boolean;
};

export class TransportProcess extends EventEmitter<TransportProcessEvents> {
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  readonly surviveAfterOctoExit: boolean;
  // Unlike the close event, this also waits for any pending process-group escalation.
  readonly processClosedPromise: Promise<void>;
  private readonly processClosed: Promise<void>;
  private finished = false;
  private termination?: Promise<void>;
  private escalationTimer?: ReturnType<typeof setTimeout>;
  private finishEscalation?: () => void;

  constructor(
    private readonly childProcess: ChildProcess,
    private readonly options: TransportProcessOptions,
  ) {
    super();
    this.stdin = childProcess.stdin;
    this.stdout = childProcess.stdout;
    this.stderr = childProcess.stderr;
    this.surviveAfterOctoExit = options.surviveAfterOctoExit === true;
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

  kill(signal?: NodeJS.Signals | number): boolean {
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

  terminate(options: { graceMs?: number } = {}): Promise<void> {
    if (this.finished && !this.termination) return this.processClosedPromise;
    if (options.graceMs === 0) {
      clearTimeout(this.escalationTimer);
      this.finishEscalation?.();
      this.kill("SIGKILL");
      this.termination = this.processClosed;
      return this.termination;
    }
    if (this.termination) return this.termination;
    this.kill("SIGTERM");
    const escalated = new Promise<void>(resolve => {
      this.finishEscalation = resolve;
      this.escalationTimer = setTimeout(() => {
        this.kill("SIGKILL");
        resolve();
      }, options.graceMs ?? 1000);
      // A detached group's descendants can outlive its leader and its stdio streams.
      if (!this.options.detached) this.escalationTimer.unref();
    });
    this.termination = Promise.all([
      this.processClosed,
      this.options.detached ? escalated : Promise.resolve(),
    ]).then(() => {
      clearTimeout(this.escalationTimer);
      this.finishEscalation?.();
    });
    return this.termination;
  }
}
