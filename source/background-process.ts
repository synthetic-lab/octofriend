import { registry } from "antipattern";
import { OctoProcess, OctoProcessManager, processes } from "./octo-process.ts";
import { sleep } from "./sleep.ts";
import { ShellOutput } from "./transports/transport-common.ts";

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

  private readonly octoProcess: OctoProcess;
  private readonly stdout = new ShellOutput();
  private readonly stderr = new ShellOutput();
  private _outputExceeded = false;
  private _status: BackgroundProcessStatus = { state: "running" };
  private readonly activityListeners = new Set<() => void>();
  private readonly processClosedPromise: Promise<void>;

  constructor(id: string, label: string, octoProcess: OctoProcess, command: string) {
    if (octoProcess.stdout == null || octoProcess.stderr == null) {
      throw new Error("Background processes must be spawned with piped stdio");
    }
    this.id = id;
    this.label = label;
    this.octoProcess = octoProcess;
    this.command = command;
    this.processClosedPromise = new Promise(resolve => octoProcess.once("close", () => resolve()));

    octoProcess.stdout.on("data", data => this.appendOutput(this.stdout, data));
    octoProcess.stderr.on("data", data => this.appendOutput(this.stderr, data));
    octoProcess.on("exit", (code, signal) => {
      this._status = { state: "exited", code, signal };
      this.emitActivityNotification();
    });
    octoProcess.on("error", error => {
      this.appendOutput(this.stderr, `Spawn error: ${error.message}\n`);
      if (this._status.state === "running") {
        this._status = { state: "exited", code: null, signal: null, error: error.message };
      }
    });
  }

  get status(): BackgroundProcessStatus {
    return this._status;
  }

  get outputExceeded(): boolean {
    return this._outputExceeded;
  }

  async kill(): Promise<void> {
    this.octoProcess.terminate({ graceMs: KILL_GRACE_MS });
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
    if (this._status.state === "exited" || this._outputExceeded || this.hasUndrainedOutput) return;
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

  constructor(private readonly octoProcessManager: OctoProcessManager) {}

  start(command: string, label: string): BackgroundProcess {
    const id = `bg-process-${++this.nextId}`;
    const octoProcess = this.octoProcessManager.spawn(command, {
      cwd: process.cwd(),
      shell: "bash",
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const backgroundProcess = new BackgroundProcess(id, label, octoProcess, command);
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

const manager = new BackgroundProcessManager(processes.manager());

export const backgroundProcesses = registry({
  manager: () => {
    return manager;
  },
});
