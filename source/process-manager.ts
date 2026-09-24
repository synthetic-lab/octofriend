import { registry } from "antipattern";
import { sleep } from "./libocto/sleep.ts";
import type { TransportProcess } from "./transports/transport-process.ts";

const CLEANUP_TIMEOUT_MS = 5000;
const FORCE_EXIT_FALLBACK_MS = 1000;
const TERMINATION_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
type TerminationSignal = (typeof TERMINATION_SIGNALS)[number];

const SIGNAL_EXIT_CODES: Record<TerminationSignal, number> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};

export class ProcessManager {
  private readonly processes = new Set<TransportProcess>();
  private readonly octoExitCleanups = new Set<(options: { graceMs?: number }) => Promise<void>>();
  private cleanupInProgress?: Promise<void>;
  private signalHandlersInstalled = false;
  private handlingTerminationSignal = false;

  register(process: TransportProcess): () => void {
    this.processes.add(process);
    const unregister = () => {
      this.processes.delete(process);
    };
    process.processClosedPromise.then(unregister, unregister);
    return unregister;
  }

  registerOctoExitCleanup(cleanup: (options: { graceMs?: number }) => Promise<void>): () => void {
    this.octoExitCleanups.add(cleanup);
    return () => this.octoExitCleanups.delete(cleanup);
  }

  private async terminate(
    processes: TransportProcess[],
    cleanups: ((options: { graceMs?: number }) => Promise<void>)[],
    options: { graceMs?: number } = {},
  ): Promise<void> {
    await Promise.allSettled([
      ...processes.map(async process => process.terminate(options)),
      ...cleanups.map(async cleanup => cleanup(options)),
    ]);
  }

  private exitTrackedProcesses(): TransportProcess[] {
    return [...this.processes].filter(process => !process.surviveAfterOctoExit);
  }

  terminateOnOctoExit(): Promise<void> {
    this.cleanupInProgress ??= withTimeout(
      this.terminate(this.exitTrackedProcesses(), [...this.octoExitCleanups]),
    );
    return this.cleanupInProgress;
  }

  /**
   * On SIGINT/SIGTERM/SIGHUP, run cleanups and then re-raise the signal so the
   * process dies with conventional signal semantics.
   */
  installGlobalProcessSignalHandlers(): void {
    if (this.signalHandlersInstalled) return;
    this.signalHandlersInstalled = true;

    process.once("exit", () => {
      for (const trackedProcess of this.exitTrackedProcesses()) {
        try {
          trackedProcess.terminate({ graceMs: 0 });
        } catch {}
      }
      for (const cleanup of this.octoExitCleanups) {
        try {
          cleanup({ graceMs: 0 });
        } catch {}
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
      await this.terminateOnOctoExit();
    } finally {
      const forceExit = setTimeout(() => {
        process.exit(SIGNAL_EXIT_CODES[signal]);
      }, FORCE_EXIT_FALLBACK_MS);
      forceExit.unref();
      process.kill(process.pid, signal);
    }
  }
}

async function withTimeout(promise: Promise<void>): Promise<void> {
  await Promise.race([promise, sleep(CLEANUP_TIMEOUT_MS)]);
}

const manager = new ProcessManager();

export const processes = registry({
  manager: () => manager,
});
