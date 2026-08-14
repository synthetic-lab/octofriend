import * as fsSync from "fs";
import fs from "fs/promises";
import path from "path";
import { quote } from "shell-quote";
import { DATA_DIR } from "./db/setup.ts";
import { OctoProcess, OctoProcessManager } from "./octo-process.ts";

/**
 * Background process lifecycle management, for the `background-process` tool.
 *
 * Processes are spawned in the project cwd via {@link OctoProcessManager},
 * each in its own process group. Session-bound processes (`global: false`)
 * are tracked in memory only and killed automatically when Octo exits; global
 * processes (`global: true`) survive Octo restarts: their metadata and logs
 * live under {@link BACKGROUND_PROCESSES_DIR}, keyed by name, so a future
 * Octo session can re-attach, check state, read output, and kill them.
 */

export const BACKGROUND_PROCESSES_DIR = path.join(DATA_DIR, "background-processes");

const MAX_BUFFERED_OUTPUT_CHARS = 256 * 1024;
const KILL_GRACE_MS = 1000;

// Names become state-directory names: keep them filesystem- and shell-safe.
const VALID_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

export type BackgroundProcessStatus = "running" | "exited" | "killed";

export type BackgroundProcessState = {
  name: string;
  command: string;
  cwd: string;
  global: boolean;
  pid: number | null;
  status: BackgroundProcessStatus;
  exitCode: number | null;
  startedAt: string; // ISO 8601
};

// The meta.json persisted in each global process's state directory.
type PersistedBackgroundProcess = {
  name: string;
  command: string;
  cwd: string;
  pid: number | null;
  status: BackgroundProcessStatus;
  exitCode: number | null;
  startedAt: string;
};

type BackgroundProcess = {
  state: BackgroundProcessState;
  /**
   * Null when we're attached to a process spawned by a previous Octo session:
   * we can still check state (via the pid), read output (via the log file),
   * and kill it (via its process group).
   */
  octoProcess: OctoProcess | null;
  /** Ring-buffer tail of stdout/stderr, for session processes. */
  outputTail: string;
  /** Log file tail target, for global processes. */
  logFile: string | null;
  /** State directory on disk, for global processes. */
  dir: string | null;
};

export class BackgroundProcessManager {
  private readonly octoProcessManager = new OctoProcessManager();
  private readonly registry = new Map<string, BackgroundProcess>();
  private readonly stateDir: string;
  private hydrated = false;

  constructor(options: { stateDir?: string } = {}) {
    this.stateDir = options.stateDir ?? BACKGROUND_PROCESSES_DIR;
  }

  async spawn(args: {
    name: string;
    command: string;
    cwd: string;
    global?: boolean;
  }): Promise<BackgroundProcessState> {
    if (!VALID_NAME.test(args.name)) {
      throw new BackgroundProcessError(
        `Invalid name "${args.name}": names must match ${VALID_NAME} (they're used as directory names for global processes).`,
      );
    }

    await this.hydrate();
    const existing = await this.refresh(this.registry.get(args.name));
    if (existing && existing.status === "running") {
      throw new BackgroundProcessError(
        `A background process named "${args.name}" is already running (pid ${existing.pid}). ` +
          `Kill it first, or pick a different name.`,
      );
    }

    const isGlobal = args.global === true;
    const env = { ...process.env };
    delete env["NODE_ENV"];

    const entry: BackgroundProcess = {
      state: {
        name: args.name,
        command: args.command,
        cwd: args.cwd,
        global: isGlobal,
        pid: null,
        status: "running",
        exitCode: null,
        startedAt: new Date().toISOString(),
      },
      octoProcess: null,
      outputTail: "",
      logFile: null,
      dir: null,
    };

    const octoProcess = isGlobal
      ? await this.spawnGlobal(entry, args, env)
      : this.spawnSession(entry, args, env);

    entry.octoProcess = octoProcess;
    entry.state.pid = octoProcess.pid ?? null;
    if (entry.state.pid == null) {
      entry.state.status = "exited";
      throw new BackgroundProcessError(
        `Failed to spawn "${args.command}": no pid, the command probably couldn't be started.`,
      );
    }

    this.registry.set(args.name, entry);
    octoProcess.once("close", code => {
      if (entry.state.status !== "running") return;
      entry.state.status = "exited";
      entry.state.exitCode = code;
      void this.persist(entry);
    });

    await this.persist(entry);
    return { ...entry.state };
  }

  private spawnSession(
    entry: BackgroundProcess,
    args: { command: string; cwd: string },
    env: NodeJS.ProcessEnv,
  ): OctoProcess {
    const octoProcess = this.octoProcessManager.spawn(args.command, {
      cwd: args.cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env,
    });

    const capture = (chunk: string | Buffer) => {
      entry.outputTail = (entry.outputTail + chunk.toString()).slice(-MAX_BUFFERED_OUTPUT_CHARS);
    };
    octoProcess.stdout?.on("data", capture);
    octoProcess.stderr?.on("data", capture);
    return octoProcess;
  }

  private async spawnGlobal(
    entry: BackgroundProcess,
    args: { name: string; command: string; cwd: string },
    env: NodeJS.ProcessEnv,
  ): Promise<OctoProcess> {
    const dir = path.join(this.stateDir, args.name);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    const logFile = path.join(dir, "output.log");
    const exitFile = path.join(dir, "exit");
    entry.logFile = logFile;
    entry.dir = dir;

    // Append mode so rehydrated output history isn't lost mid-stream, and
    // record the real exit code: the wrapper shell's own `close` code would
    // otherwise be lost to whoever respawns us after a restart.
    const fd = fsSync.openSync(logFile, "a");
    try {
      const wrapped = `${args.command}\ncode=$?\nprintf '%s' "$code" > ${quote([exitFile])}`;
      const octoProcess = this.octoProcessManager.spawn(wrapped, {
        cwd: args.cwd,
        shell: true,
        stdio: ["ignore", fd, fd],
        detached: true,
        surviveAfterOctoExit: true,
        env,
      });
      // The process must outlive Octo, so don't keep Octo's event loop alive for it.
      octoProcess.unref();
      return octoProcess;
    } finally {
      // The child holds its own duped copy of the fd.
      fsSync.closeSync(fd);
    }
  }

  /** Load state for global processes spawned by previous Octo sessions. */
  private async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;

    let names: string[];
    try {
      names = await fs.readdir(this.stateDir);
    } catch {
      return; // no global processes yet
    }

    for (const name of names) {
      if (this.registry.has(name) || !VALID_NAME.test(name)) continue;
      const dir = path.join(this.stateDir, name);
      let persisted: PersistedBackgroundProcess;
      try {
        persisted = JSON.parse(
          await fs.readFile(path.join(dir, "meta.json"), "utf8"),
        ) as PersistedBackgroundProcess;
      } catch {
        continue; // unfinished or corrupt state; ignore
      }
      this.registry.set(name, {
        state: {
          name: persisted.name,
          command: persisted.command,
          cwd: persisted.cwd,
          global: true,
          pid: persisted.pid,
          status: persisted.status,
          exitCode: persisted.exitCode,
          startedAt: persisted.startedAt,
        },
        octoProcess: null,
        outputTail: "",
        logFile: path.join(dir, "output.log"),
        dir,
      });
    }
  }

  /**
   * Recompute a process's status. Processes we spawned this session follow
   * `close` events; attached (previous-session) processes need a pid check.
   */
  private async refresh(
    entry: BackgroundProcess | undefined,
  ): Promise<BackgroundProcessState | undefined> {
    if (!entry) return undefined;
    const state = entry.state;
    if (state.status !== "running") return state;
    if (entry.octoProcess) return state; // close events keep this accurate

    if (state.pid == null || !pidAlive(state.pid)) {
      state.status = "exited";
      state.exitCode = await readExitCode(entry.dir);
      await this.persist(entry);
    }
    return state;
  }

  private async requireEntry(name: string): Promise<BackgroundProcess> {
    await this.hydrate();
    const entry = this.registry.get(name);
    if (!entry) {
      throw new BackgroundProcessError(
        `No background process named "${name}". ` +
          `Only processes still running since the last Octo restart are tracked.`,
      );
    }
    return entry;
  }

  /** Best-effort: write the process's current state to its state directory. */
  private async persist(entry: BackgroundProcess): Promise<void> {
    if (!entry.dir) return; // only global processes persist
    const state = entry.state;
    const persisted: PersistedBackgroundProcess = {
      name: state.name,
      command: state.command,
      cwd: state.cwd,
      pid: state.pid,
      status: state.status,
      exitCode: state.exitCode,
      startedAt: state.startedAt,
    };
    try {
      await fs.writeFile(
        path.join(entry.dir, "meta.json"),
        JSON.stringify(persisted, null, 2) + "\n",
      );
    } catch {
      // The state directory may have been removed externally; not fatal.
    }
  }

  async status(name: string): Promise<BackgroundProcessState> {
    const entry = await this.requireEntry(name);
    return { ...(await this.refresh(entry))! };
  }

  async list(): Promise<BackgroundProcessState[]> {
    await this.hydrate();
    const states: BackgroundProcessState[] = [];
    for (const entry of this.registry.values()) {
      states.push({ ...(await this.refresh(entry))! });
    }
    return states.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  /** The most recent output, at most `lines` lines (default 50). */
  async output(
    name: string,
    options: { lines?: number } = {},
  ): Promise<{
    state: BackgroundProcessState;
    output: string;
  }> {
    const entry = await this.requireEntry(name);
    const state = { ...(await this.refresh(entry))! };

    let tail = entry.outputTail;
    if (entry.logFile) tail = (await readTail(entry.logFile)) ?? tail;
    // Commands usually end their output with a trailing newline; don't count
    // the resulting empty line when truncating.
    const lines = tail.replace(/\n+$/, "").split("\n");
    const truncated = options.lines != null && lines.length > options.lines;
    return {
      state,
      output:
        (truncated ? `[${lines.length - options.lines!} earlier lines omitted]\n` : "") +
        (options.lines != null ? lines.slice(-options.lines).join("\n") : tail),
    };
  }

  async kill(name: string): Promise<BackgroundProcessState> {
    const entry = await this.requireEntry(name);
    const state = await this.refresh(entry);
    if (state!.status !== "running") return { ...state! };

    state!.status = "killed";
    if (entry.octoProcess) {
      entry.octoProcess.terminate({ graceMs: KILL_GRACE_MS });
    } else if (state!.pid != null) {
      signalGroup(state!.pid, "SIGTERM");
      const deadline = Date.now() + KILL_GRACE_MS;
      while (Date.now() < deadline && pidAlive(state!.pid)) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      signalGroup(state!.pid, "SIGKILL");
    }
    await this.persist(entry);
    return { ...state! };
  }
}

export class BackgroundProcessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackgroundProcessError";
  }
}

export const backgroundProcesses = new BackgroundProcessManager();

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the process exists but we can't signal it
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals) {
  try {
    // Negative PID signals the whole (detached) process group
    process.kill(-pid, signal);
  } catch {}
}

async function readExitCode(dir: string | null): Promise<number | null> {
  if (!dir) return null;
  try {
    const text = await fs.readFile(path.join(dir, "exit"), "utf8");
    const code = parseInt(text, 10);
    return Number.isNaN(code) ? null : code;
  } catch {
    return null;
  }
}

/** Last ~256KB of a log file, or null if it's missing. */
async function readTail(logFile: string): Promise<string | null> {
  let handle: fsSync.promises.FileHandle | null = null;
  try {
    handle = await fsSync.promises.open(logFile, "r");
    const stat = await handle.stat();
    const start = Math.max(0, stat.size - MAX_BUFFERED_OUTPUT_CHARS);
    const { buffer } = await handle.read(
      Buffer.alloc(stat.size - start),
      0,
      stat.size - start,
      start,
    );
    return buffer.toString();
  } catch {
    return null;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}
