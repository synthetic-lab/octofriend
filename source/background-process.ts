import { registry } from "antipattern";
import type { TransportProcess } from "./transports/transport-process.ts";
import { sleep } from "./sleep.ts";
import { ShellOutput, type Transport } from "./transports/transport-common.ts";

const KILL_GRACE_MS = 1000;

export type BackgroundProcessStatus =
  | { readonly state: "running" }
  | {
      readonly state: "exited";
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
      readonly error?: string;
    };

export class BackgroundProcess {
  readonly id: string;
  readonly label: string;
  readonly command: string;

  private readonly process: TransportProcess;
  private readonly stdout = new ShellOutput();
  private readonly stderr = new ShellOutput();
  private _outputExceeded = false;
  private _status: BackgroundProcessStatus = { state: "running" };
  private readonly activityListeners = new Set<() => void>();
  private readonly processClosedPromise: Promise<void>;

  constructor(id: string, label: string, process: TransportProcess, command: string) {
    if (process.stdout == null || process.stderr == null) {
      throw new Error("Background processes must be spawned with piped stdio");
    }
    this.id = id;
    this.label = label;
    this.process = process;
    this.command = command;
    this.processClosedPromise = process.processClosedPromise;

    process.stdout.on("data", data => this.appendOutput(this.stdout, data));
    process.stderr.on("data", data => this.appendOutput(this.stderr, data));
    process.on("exit", (code, signal) => {
      this._status = { state: "exited", code, signal };
      this.emitActivityNotification();
    });
    process.on("error", error => {
      this.appendOutput(this.stderr, `Spawn error: ${error.message}\n`);
      if (this._status.state === "running") {
        this._status = { state: "exited", code: null, signal: null, error: error.message };
      }
      this.emitActivityNotification();
    });
  }

  get status(): BackgroundProcessStatus {
    return this._status;
  }

  get outputExceeded(): boolean {
    return this._outputExceeded;
  }

  async kill(): Promise<void> {
    await this.process.terminate({ graceMs: KILL_GRACE_MS });
    await this.processClosedPromise;
  }

  get hasUndrainedOutput(): boolean {
    return this.stdout.hasUndrainedOutput() || this.stderr.hasUndrainedOutput();
  }

  drainUnreadOutput(): { stdout: string; stderr: string } {
    return {
      stdout: this.stdout.drainNewOutput(),
      stderr: this.stderr.drainNewOutput(),
    };
  }

  async awaitActivity(timeoutMs: number, userAbortSignal: AbortSignal): Promise<void> {
    if (
      userAbortSignal.aborted ||
      this._status.state === "exited" ||
      this._outputExceeded ||
      this.hasUndrainedOutput
    )
      return;
    let onActivity: () => void = () => {};
    const activityOccurred = new Promise<void>(resolve => {
      onActivity = resolve;
    });
    this.activityListeners.add(onActivity);
    userAbortSignal.addEventListener("abort", onActivity);
    await Promise.race([activityOccurred, sleep(timeoutMs)]);
    userAbortSignal.removeEventListener("abort", onActivity);
    this.activityListeners.delete(onActivity);
  }

  private appendOutput(output: ShellOutput, data: string | Buffer): void {
    if (output.append(data)) {
      this.emitActivityNotification();
      return;
    }
    this._outputExceeded = true;
    this.emitActivityNotification();
    void this.kill();
  }

  private emitActivityNotification(): void {
    for (const listener of [...this.activityListeners]) {
      this.activityListeners.delete(listener);
      listener();
    }
  }
}

export class BackgroundProcessManager {
  private readonly backgroundProcesses = new Map<string, BackgroundProcess>();
  private nextId = 0;

  constructor(private readonly transport: Transport) {}

  start(command: string, label: string): BackgroundProcess {
    const id = `bg-process-${++this.nextId}`;
    const runningProcess = this.transport.spawn(command, {
      cwd: this.transport.cwd,
      shell: "bash",
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const backgroundProcess = new BackgroundProcess(id, label, runningProcess, command);
    this.backgroundProcesses.set(id, backgroundProcess);
    return backgroundProcess;
  }

  poll(id: string): BackgroundProcess | null {
    return this.backgroundProcesses.get(id) ?? null;
  }

  async kill(id: string): Promise<BackgroundProcess | null> {
    const backgroundProcess = this.backgroundProcesses.get(id);
    if (backgroundProcess == null) return null;
    await backgroundProcess.kill();
    return backgroundProcess;
  }

  list(): BackgroundProcess[] {
    return [...this.backgroundProcesses.values()];
  }
}

let manager: BackgroundProcessManager | undefined;

export const backgroundProcesses = registry({
  manager: (transport: Transport) => (manager ??= new BackgroundProcessManager(transport)),
});
