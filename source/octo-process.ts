import {
  execFile,
  spawn,
  ChildProcess,
  type ExecFileException,
  type ExecFileOptions,
  type SpawnOptions,
} from "child_process";

/**
 * Child process lifecycle management, over `child_process`.
 *
 * All spawning goes through {@link OctoProcessManager}, so spawned processes
 * can be terminated when Octo exits (unless spawned with
 * `surviveAfterOctoExit`). {@link registerCleanup} and
 * {@link installGlobalProcessSignalHandlers} run shutdown logic even on
 * SIGINT/SIGTERM/SIGHUP, where `try/finally` blocks never run.
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

export class OctoProcess extends ChildProcess {
  /** signal the whole process group on terminate */
  declare detached?: boolean;
  /** don't kill when Octo exits */
  declare surviveAfterOctoExit?: boolean;

  constructor(childProcess: ChildProcess, options: OctoProcessOptions) {
    super();
    // Since Node creates processes via factories (spawn), we can't use `extends` directly
    const octoProcess = childProcess as OctoProcess;
    Object.setPrototypeOf(octoProcess, OctoProcess.prototype);
    octoProcess.detached = options.detached;
    octoProcess.surviveAfterOctoExit = options.surviveAfterOctoExit;
    return octoProcess;
  }

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

const octoProcesses = new Set<OctoProcess>();

const cleanups = new Set<() => Promise<void> | void>();

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
 * `child_process.execFile`, but everything spawned is tracked here (for
 * {@link OctoProcessManager.terminateAll}) and in the exit-time registry,
 * and is untracked automatically when it closes.
 */
export class OctoProcessManager {
  private readonly processes = new Set<OctoProcess>();

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
    if (!options.surviveAfterOctoExit) {
      octoProcesses.add(octoProcess);
      octoProcess.once("close", () => octoProcesses.delete(octoProcess));
    }
    return octoProcess;
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

/** Terminate every exit-tracked process, escalating to SIGKILL. */
export function killAllOctoProcesses(): void {
  for (const octoProcess of [...octoProcesses]) {
    octoProcess.terminate();
  }
}

export function registerCleanup(cleanup: () => Promise<void> | void): () => void {
  cleanups.add(cleanup);
  return () => {
    cleanups.delete(cleanup);
  };
}

let cleanupsStarted = false;

/**
 * Run registered cleanups (bounded by a timeout so a hung cleanup can't block
 * shutdown), then terminate remaining tracked processes. Only runs once.
 */
export async function runCleanups(): Promise<void> {
  if (cleanupsStarted) return;
  cleanupsStarted = true;

  const work = (async () => {
    for (const cleanup of [...cleanups]) {
      try {
        await cleanup();
      } catch {
        // Cleanup is best-effort during shutdown
      }
    }
    killAllOctoProcesses();
  })();

  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      work,
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, CLEANUP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

let signalHandlersInstalled = false;
let handlingTerminationSignal = false;

/**
 * On SIGINT/SIGTERM/SIGHUP, run cleanups and then re-raise the signal so the
 * process dies with conventional signal semantics.
 */
export function installGlobalProcessSignalHandlers(): void {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;

  process.once("exit", () => {
    for (const octoProcess of [...octoProcesses]) {
      signalOctoProcess(octoProcess, "SIGKILL");
    }
  });

  for (const signal of TERMINATION_SIGNALS) {
    process.once(signal, () => {
      void handleTerminationSignal(signal);
    });
  }
}

async function handleTerminationSignal(signal: TerminationSignal): Promise<void> {
  if (handlingTerminationSignal) return;
  handlingTerminationSignal = true;

  try {
    await runCleanups();
  } finally {
    const forceExit = setTimeout(() => {
      process.exit(SIGNAL_EXIT_CODES[signal]);
    }, FORCE_EXIT_FALLBACK_MS);
    forceExit.unref?.();

    process.kill(process.pid, signal);
  }
}
