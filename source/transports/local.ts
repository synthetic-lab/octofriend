import fs from "fs/promises";
import path from "path";
import { spawn, execFile, type ChildProcess } from "child_process";
import {
  Transport,
  runShell,
  runBackgroundShell,
  type BackgroundShellOptions,
} from "./transport-common.ts";
import { processes } from "../process-manager.ts";
import { err, errorToString, ok, type Result } from "../libocto/result.ts";
import {
  TransportProcess,
  type TransportProcessOptions,
  type ProcessSpawnOptions,
  type ProcessExecFileOptions,
  type ProcessExecFileCallback,
} from "./transport-process.ts";

const KILL_GRACE_MS = 500;

const STRIPPED_ENV_VARS = ["NODE_ENV", "NAPI_RS_NATIVE_LIBRARY_PATH", "CANARY_OCTO"];

export class LocalTransport implements Transport {
  cwd = process.cwd();
  // bash over sh: available on most local setups, and tolerant of LLM bash-isms
  readonly commandShell = "bash";
  private readonly runningProcesses = new Set<TransportProcess>();
  private readonly processManager = processes.manager();

  async close() {
    await Promise.all(
      [...this.runningProcesses].map(localProcess =>
        localProcess.terminate({ graceMs: KILL_GRACE_MS }),
      ),
    );
  }

  spawn(command: string, args: readonly string[], options: ProcessSpawnOptions): TransportProcess {
    const { surviveAfterOctoExit, ...spawnOptions } = options;
    return this.manage(
      spawn(command, args, {
        cwd: this.cwd,
        env: commandEnvironment(),
        ...spawnOptions,
      }),
      { detached: options.detached, surviveAfterOctoExit },
    );
  }

  execFile(
    file: string,
    args: readonly string[],
    options: ProcessExecFileOptions,
    callback: ProcessExecFileCallback | undefined,
  ): TransportProcess {
    const localProcess = this.manage(
      execFile(
        file,
        args,
        {
          cwd: this.cwd,
          env: commandEnvironment(),
          ...options,
          encoding: "utf8",
        },
        callback,
      ),
      {},
    );
    localProcess.on("error", () => {});
    return localProcess;
  }

  private manage(childProcess: ChildProcess, options: TransportProcessOptions): TransportProcess {
    const localProcess = new TransportProcess(childProcess, options);
    this.runningProcesses.add(localProcess);
    this.processManager.register(localProcess);
    void localProcess.processClosedPromise.then(() => this.runningProcesses.delete(localProcess));
    return localProcess;
  }

  async writeFile(_: AbortSignal, file: string, contents: string): Promise<Result<null, string>> {
    try {
      await fs.writeFile(file, contents, "utf8");
      return ok(null);
    } catch (e) {
      return err(`Could not write file ${file}: ${errorToString(e)}`);
    }
  }

  async readFile(_: AbortSignal, file: string): Promise<Result<string, string>> {
    try {
      return ok(await fs.readFile(file, "utf8"));
    } catch (e) {
      return err(`Could not read file ${file}: ${errorToString(e)}`);
    }
  }

  async modTime(_: AbortSignal, file: string): Promise<Result<number, string>> {
    try {
      const stat = await fs.stat(file);
      return ok(stat.mtimeMs);
    } catch (e) {
      return err(`Could not get modified time for ${file}: ${errorToString(e)}`);
    }
  }

  async resolvePath(_: AbortSignal, file: string): Promise<Result<string, string>> {
    try {
      return ok(await fs.realpath(file));
    } catch {
      return ok(path.resolve(file));
    }
  }

  async mkdir(_: AbortSignal, dirpath: string): Promise<Result<null, string>> {
    try {
      await fs.mkdir(dirpath, { recursive: true });
      return ok(null);
    } catch (e) {
      return err(`Could not create directory ${dirpath}: ${errorToString(e)}`);
    }
  }

  async readdir(
    _: AbortSignal,
    dirpath: string,
  ): Promise<Result<Array<{ entry: string; isDirectory: boolean }>, string>> {
    try {
      const entries = await fs.readdir(dirpath, { withFileTypes: true });
      return ok(
        await Promise.all(
          entries.map(async entry => {
            // For symlinks, resolve to determine if target is a directory
            if (entry.isSymbolicLink()) {
              const fullPath = path.join(dirpath, entry.name);
              try {
                const stat = await fs.stat(fullPath); // follows symlinks
                return { entry: entry.name, isDirectory: stat.isDirectory() };
              } catch {
                // Broken symlink or permission error - treat as file
                return { entry: entry.name, isDirectory: false };
              }
            }
            return { entry: entry.name, isDirectory: entry.isDirectory() };
          }),
        ),
      );
    } catch (e) {
      return err(`Could not read directory ${dirpath}: ${errorToString(e)}`);
    }
  }

  async pathExists(_: AbortSignal, file: string): Promise<Result<boolean, string>> {
    try {
      await fs.stat(file);
      return ok(true);
    } catch (e) {
      if (isMissingFileError(e)) return ok(false);
      return err(`Could not stat ${file}: ${errorToString(e)}`);
    }
  }

  async isDirectory(_: AbortSignal, file: string): Promise<Result<boolean, string>> {
    try {
      const stat = await fs.stat(file);
      return ok(stat.isDirectory());
    } catch (e) {
      if (isMissingFileError(e)) return ok(false);
      return err(`Could not stat ${file}: ${errorToString(e)}`);
    }
  }

  backgroundShell(options: BackgroundShellOptions) {
    return runBackgroundShell(this, options);
  }

  async shell(signal: AbortSignal, cmd: string, timeout: number) {
    return runShell(this, signal, cmd, timeout);
  }
}

function commandEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of STRIPPED_ENV_VARS) delete env[name];
  return env;
}

function isMissingFileError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e.code === "ENOENT" || e.code === "ENOTDIR")
  );
}
