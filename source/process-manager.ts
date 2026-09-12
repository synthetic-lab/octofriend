import { registry } from "antipattern";
import { sleep } from "./sleep.ts";

export type TerminateOptions = { graceMs?: number };

export type ProcessRegistration = {
  cleanup: (options: TerminateOptions) => Promise<void> | void;
  processClosedPromise?: Promise<void>;
  surviveAfterOctoExit?: boolean;
};

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
  private readonly processes = new Set<ProcessRegistration>();
  private cleanupInProgress?: Promise<void>;
  private signalHandlersInstalled = false;
  private handlingTerminationSignal = false;

  register(registration: ProcessRegistration): () => void {
    this.processes.add(registration);
    const unregister = () => {
      this.processes.delete(registration);
    };
    registration.processClosedPromise?.then(unregister, unregister);
    return unregister;
  }

  async terminateAll(options: TerminateOptions = {}): Promise<void> {
    await this.terminate([...this.processes], options);
  }

  private async terminate(
    registrations: ProcessRegistration[],
    options: TerminateOptions = {},
  ): Promise<void> {
    await Promise.allSettled(
      registrations.map(async registration => registration.cleanup(options)),
    );
  }

  private exitTrackedProcesses(): ProcessRegistration[] {
    return [...this.processes].filter(registration => !registration.surviveAfterOctoExit);
  }

  runCleanups(): Promise<void> {
    this.cleanupInProgress ??= this.cleanup();
    return this.cleanupInProgress;
  }

  private async cleanup(): Promise<void> {
    await withTimeout(this.terminate(this.exitTrackedProcesses()));
  }

  /**
   * On SIGINT/SIGTERM/SIGHUP, run cleanups and then re-raise the signal so the
   * process dies with conventional signal semantics.
   */
  installGlobalProcessSignalHandlers(): void {
    if (this.signalHandlersInstalled) return;
    this.signalHandlersInstalled = true;

    process.once("exit", () => {
      for (const registration of this.exitTrackedProcesses()) {
        try {
          registration.cleanup({ graceMs: 0 });
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
      await this.runCleanups();
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
