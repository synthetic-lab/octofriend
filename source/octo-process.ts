import {
  execFile,
  spawn,
  type ChildProcess,
  type ExecFileException,
  type ExecFileOptions,
  type SpawnOptions,
} from "child_process";
import { EventEmitter } from "events";
import type { Readable, Writable } from "stream";
import { registry } from "antipattern";
import { sleep } from "./sleep.ts";

/**
 * Spawning child processes should go through {@link OctoProcessManager}, so all processes
 * can be terminated when Octo exits (unless spawned with
 * `surviveAfterOctoExit`). {@link OctoProcessManager.registerCleanup} and
 * {@link OctoProcessManager.installGlobalProcessSignalHandlers} run shutdown
 * logic even on SIGINT/SIGTERM/SIGHUP
 *
 * Each manager owns its own tracked processes and cleanups; call sites should
 * generally use the shared instance from {@link processes} rather than
 * constructing their own, so tests can mock out process management entirely.
 */

type OctoProcessOptions = {
  /**
   * Run the child in its own process group, independent of Octo's session;
   * termination then signals the whole group, so grandchildren die too.
   */
  detached?: boolean;
  /** Don't terminate the process when Octo exits. */
  surviveAfterOctoExit?: boolean;
};

export type OctoProcessEvents = {
  /** The process could not be spawned or was killed by a signal. */
  error: [error: Error];
  /** The process successfully spawned. */
  spawn: [];
  /** The process ended on its own. */
  exit: [code: number | null, signal: NodeJS.Signals | null];
  /** The process ended and its stdio streams have closed. */
  close: [code: number | null, signal: NodeJS.Signals | null];
};

export class OctoProcess extends EventEmitter<OctoProcessEvents> {
  /** signal the whole process group on terminate */
  readonly detached?: boolean;
  /** don't kill when Octo exits */
  readonly surviveAfterOctoExit?: boolean;

  private readonly childProcess: ChildProcess;

  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;

  constructor(childProcess: ChildProcess, options: OctoProcessOptions) {
    super();
    this.childProcess = childProcess;
    this.detached = options.detached;
    this.surviveAfterOctoExit = options.surviveAfterOctoExit;
    this.stdin = childProcess.stdin;
    this.stdout = childProcess.stdout;
    this.stderr = childProcess.stderr;

    childProcess.on("error", error => this.emit("error", error));
    childProcess.on("spawn", () => this.emit("spawn"));
    childProcess.on("exit", (code, signal) => this.emit("exit", code, signal));
    childProcess.on("close", (code, signal) => this.emit("close", code, signal));
  }

  /** The process's PID, like `ChildProcess.pid`. */
  get pid(): number | undefined {
    return this.childProcess.pid;
  }

  /** Send a signal to the process, like `ChildProcess.kill`. */
  kill(signal?: NodeJS.Signals | number): boolean {
    return this.childProcess.kill(signal);
  }

  /** Allow the parent to exit independently of this process, like `ChildProcess.unref`. */
  unref(): void {
    this.childProcess.unref();
  }

  /** Send SIGTERM, escalating to SIGKILL after the grace period (default 1s). */
  terminate(opts: { graceMs?: number } = {}): void {
    signalOctoProcess(this, "SIGTERM");
    const timer = setTimeout(
      () => signalOctoProcess(this, "SIGKILL"),
      opts.graceMs ?? SIGKILL_GRACE_MS,
    );
    // The escalation timer must not keep the event loop alive on its own.
    timer.unref?.();
  }
}

export type OctoSpawnOptions = SpawnOptions & OctoProcessOptions;
export type OctoExecFileOptions = ExecFileOptions & OctoProcessOptions;

/** `stdout`/`stderr` are strings unless `encoding: "buffer"` is passed, mirroring `child_process.execFile`. */
export type OctoExecFileCallback = (
  error: ExecFileException | null,
  stdout: string | Buffer,
  stderr: string | Buffer,
) => void;

type Cleanup = () => Promise<void> | void;

const SIGKILL_GRACE_MS = 1000;
const CLEANUP_TIMEOUT_MS = 5000;
const FORCE_EXIT_FALLBACK_MS = 1000;

const TERMINATION_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
type TerminationSignal = (typeof TERMINATION_SIGNALS)[number];

// Conventional exit codes: 128 + signal number
const SIGNAL_EXIT_CODES: Record<TerminationSignal, number> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};

/**
 * The only way to spawn child processes: like `child_process.spawn`/
 * `child_process.execFile`, but everything spawned is tracked by the manager
 * (for {@link OctoProcessManager.terminateAll} and exit-time termination),
 * and is untracked automatically when it closes.
 */
export class OctoProcessManager {
  private readonly processes = new Set<OctoProcess>();
  private readonly cleanups = new Set<Cleanup>();
  private cleanupsStarted = false;
  private signalHandlersInstalled = false;
  private handlingTerminationSignal = false;

  /** Terminate every process this manager spawned that is still running. */
  terminateAll(opts: { graceMs?: number } = {}): void {
    for (const octoProcess of [...this.processes]) {
      octoProcess.terminate(opts);
    }
  }

  spawn(command: string, options?: OctoSpawnOptions): OctoProcess;
  spawn(command: string, args: readonly string[], options?: OctoSpawnOptions): OctoProcess;
  spawn(
    command: string,
    argsOrOptions?: readonly string[] | OctoSpawnOptions,
    maybeOptions: OctoSpawnOptions = {},
  ): OctoProcess {
    const hasArgs = Array.isArray(argsOrOptions);
    const args = (hasArgs ? argsOrOptions : []) as readonly string[];
    const options = ((hasArgs ? maybeOptions : argsOrOptions) ?? {}) as OctoSpawnOptions;
    const { surviveAfterOctoExit: surviveExit, ...spawnOptions } = options;
    return this.manage(spawn(command, args, spawnOptions), {
      surviveAfterOctoExit: surviveExit,
      detached: spawnOptions.detached,
    });
  }

  execFile(file: string, callback?: OctoExecFileCallback): OctoProcess;
  execFile(file: string, args: readonly string[], callback?: OctoExecFileCallback): OctoProcess;
  execFile(
    file: string,
    options?: OctoExecFileOptions,
    callback?: OctoExecFileCallback,
  ): OctoProcess;
  execFile(
    file: string,
    args: readonly string[],
    options?: OctoExecFileOptions,
    callback?: OctoExecFileCallback,
  ): OctoProcess;
  execFile(
    file: string,
    argsOrOptionsOrCallback?: readonly string[] | OctoExecFileOptions | OctoExecFileCallback,
    optionsOrCallback?: OctoExecFileOptions | OctoExecFileCallback,
    maybeCallback?: OctoExecFileCallback,
  ): OctoProcess {
    const hasArgs = Array.isArray(argsOrOptionsOrCallback);
    const args = (hasArgs ? argsOrOptionsOrCallback : []) as readonly string[];
    const optionsArg = hasArgs ? optionsOrCallback : argsOrOptionsOrCallback;
    const callbackArg = hasArgs ? maybeCallback : optionsOrCallback;
    const options = (typeof optionsArg === "function" ? undefined : optionsArg) as
      | OctoExecFileOptions
      | undefined;
    const callback = (typeof optionsArg === "function" ? optionsArg : callbackArg) as
      | OctoExecFileCallback
      | undefined;
    const { surviveAfterOctoExit: surviveExit, ...execOptions } = options ?? {};
    return this.manage(execFile(file, args, execOptions, callback ?? null), {
      surviveAfterOctoExit: surviveExit,
    });
  }

  private manage(childProcess: ChildProcess, options: OctoProcessOptions): OctoProcess {
    const octoProcess = new OctoProcess(childProcess, options);

    this.processes.add(octoProcess);
    octoProcess.once("close", () => this.processes.delete(octoProcess));
    return octoProcess;
  }

  /** Tracked processes that should die when Octo exits. */
  private exitTrackedProcesses(): OctoProcess[] {
    return [...this.processes].filter(octoProcess => !octoProcess.surviveAfterOctoExit);
  }

  /** Terminate every exit-tracked process, escalating to SIGKILL. */
  private shutdownChildProcesses(): void {
    for (const octoProcess of this.exitTrackedProcesses()) {
      octoProcess.terminate();
    }
  }

  /** Register a cleanup to run during shutdown; returns an unregister function. */
  registerCleanup(cleanup: Cleanup): () => void {
    this.cleanups.add(cleanup);
    return () => {
      this.cleanups.delete(cleanup);
    };
  }

  /**
   * Run registered cleanups (bounded by a timeout so a hung cleanup can't block
   * shutdown), then terminate remaining exit-tracked processes. Only runs once.
   */
  async runCleanups(): Promise<void> {
    if (this.cleanupsStarted) return;
    this.cleanupsStarted = true;

    const cleanupFns = (async () => {
      for (const cleanup of [...this.cleanups]) {
        try {
          await cleanup();
        } catch {
          // Cleanup is best-effort during shutdown
        }
      }
      this.shutdownChildProcesses();
    })();

    await Promise.race([cleanupFns, sleep(CLEANUP_TIMEOUT_MS)]);
  }

  /**
   * On SIGINT/SIGTERM/SIGHUP, run cleanups and then re-raise the signal so the
   * process dies with conventional signal semantics.
   */
  installGlobalProcessSignalHandlers(): void {
    if (this.signalHandlersInstalled) return;
    this.signalHandlersInstalled = true;

    process.once("exit", () => {
      for (const octoProcess of this.exitTrackedProcesses()) {
        signalOctoProcess(octoProcess, "SIGKILL");
      }
    });

    for (const signal of TERMINATION_SIGNALS) {
      process.once(signal, () => {
        void this.handleTerminationSignal(signal);
      });
    }
  }

  private async handleTerminationSignal(signal: TerminationSignal): Promise<void> {
    if (this.handlingTerminationSignal) return;
    this.handlingTerminationSignal = true;

    try {
      await this.runCleanups();
    } finally {
      const forceExit = setTimeout(() => {
        process.exit(SIGNAL_EXIT_CODES[signal]);
      }, FORCE_EXIT_FALLBACK_MS);
      forceExit.unref?.();

      process.kill(process.pid, signal);
    }
  }
}

function signalOctoProcess(octoProcess: OctoProcess, signal: NodeJS.Signals) {
  if (octoProcess.detached && octoProcess.pid != null) {
    try {
      // Negative PID signals the whole process group
      process.kill(-octoProcess.pid, signal);
      return;
    } catch {
      // Fall through to signaling just the process
    }
  }
  try {
    octoProcess.kill(signal);
  } catch {}
}

const manager = new OctoProcessManager();

/**
 * The shared process manager used throughout the app. In tests, mock out all
 * process management with `withMock(processes, "manager", () => mock, cb)`.
 */
export const processes = registry({
  manager: () => {
    return manager;
  },
});
