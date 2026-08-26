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
    };

export class BackgroundProcess {
  readonly id: string;
  readonly command: string;

  private readonly octoProcess: OctoProcess;
  private readonly output = new ShellOutput();
  private readOffset = 0;
  private _outputExceeded = false;
  private _status: BackgroundProcessStatus = { state: "running" };
  private readonly activityListeners = new Set<() => void>();

  constructor(id: string, octoProcess: OctoProcess, command: string) {
    if (octoProcess.stdout == null || octoProcess.stderr == null) {
      throw new Error("Background processes must be spawned with piped stdio");
    }
    this.id = id;
    this.octoProcess = octoProcess;
    this.command = command;

    octoProcess.stdout.on("data", data => this.appendOutput(data));
    octoProcess.stderr.on("data", data => this.appendOutput(data));
    octoProcess.on("exit", (code, signal) => {
      this._status = { state: "exited", code, signal };
      this.emitActivityNotification();
    });
    octoProcess.on("error", error => {
      this.appendOutput(`Spawn error: ${error.message}\n`);
      if (this._status.state === "running") {
        this._status = { state: "exited", code: null, signal: null };
      }
    });
  }

  get status(): BackgroundProcessStatus {
    return this._status;
  }

  get outputExceeded(): boolean {
    return this._outputExceeded;
  }

  kill(): void {
    this.octoProcess.terminate({ graceMs: KILL_GRACE_MS });
  }

  get hasUnreadOutput(): boolean {
    const buffered = this.output.getOutput();
    return buffered != null && buffered.length > this.readOffset;
  }

  drainUnreadOutput(): string {
    const buffered = this.output.getOutput();
    if (buffered == null) return "";
    const output = buffered.slice(this.readOffset);
    this.readOffset = buffered.length;
    return output;
  }

  async awaitActivity(timeoutMs: number, userAbortSignal: AbortSignal): Promise<void> {
    if (this._status.state === "exited" || this._outputExceeded || this.hasUnreadOutput) return;
    let onActivity: () => void = () => {};
    const activityOccurred = new Promise<void>(resolve => {
      onActivity = resolve;
    });
    this.activityListeners.add(onActivity);
    userAbortSignal.addEventListener("abort", onActivity, { once: true });
    await Promise.race([activityOccurred, sleep(timeoutMs)]);
    userAbortSignal.removeEventListener("abort", onActivity);
    this.activityListeners.delete(onActivity);
  }

  private appendOutput(data: string | Buffer): void {
    if (this.output.append(data)) {
      this.emitActivityNotification();
      return;
    }
    this._outputExceeded = true;
    this.emitActivityNotification();
    this.kill();
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

  start(command: string): BackgroundProcess {
    const id = `bg-${++this.nextId}`;
    const octoProcess = this.octoProcessManager.spawn(command, {
      cwd: process.cwd(),
      shell: "bash",
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const backgroundProcess = new BackgroundProcess(id, octoProcess, command);
    this.backgroundProcesses.set(id, backgroundProcess);
    return backgroundProcess;
  }

  poll(id: string): BackgroundProcess | null {
    return this.backgroundProcesses.get(id) ?? null;
  }

  kill(id: string): BackgroundProcess | null {
    const backgroundProcess = this.backgroundProcesses.get(id);
    if (backgroundProcess == null) return null;
    backgroundProcess.kill();
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
