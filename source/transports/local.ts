import fs from "fs/promises";
import path from "path";
import { runShell } from "./shell.ts";
import { spawn, execFile, type ChildProcess } from "child_process";
import { Transport, TransportError } from "./transport-common.ts";
import { ProcessManager, processes } from "../process-manager.ts";
import {
  ChildTransportProcess,
  type TransportProcess,
  type TransportSpawnOptions,
  type TransportExecFileOptions,
  type TransportExecFileCallback,
  spawnArguments,
  execFileArguments,
} from "./transport-process.ts";

const KILL_GRACE_MS = 500;

const STRIPPED_ENV_VARS = ["NODE_ENV", "NAPI_RS_NATIVE_LIBRARY_PATH", "CANARY_OCTO"];

export class LocalTransport implements Transport {
  cwd = process.cwd();
  private readonly runningProcesses = new Set<TransportProcess>();

  constructor(private readonly processManager: ProcessManager = processes.manager()) {}

  async close() {
    await Promise.all(
      [...this.runningProcesses].map(localProcess =>
        localProcess.terminate({ graceMs: KILL_GRACE_MS }),
      ),
    );
  }

  spawn(command: string, options?: TransportSpawnOptions): TransportProcess;
  spawn(
    command: string,
    args: readonly string[],
    options?: TransportSpawnOptions,
  ): TransportProcess;
  spawn(
    command: string,
    argsOrOptions?: readonly string[] | TransportSpawnOptions,
    maybeOptions?: TransportSpawnOptions,
  ): TransportProcess {
    const { args, options } = spawnArguments(argsOrOptions, maybeOptions);
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

  execFile(file: string, callback?: TransportExecFileCallback): TransportProcess;
  execFile(
    file: string,
    args: readonly string[],
    callback?: TransportExecFileCallback,
  ): TransportProcess;
  execFile(
    file: string,
    options?: TransportExecFileOptions,
    callback?: TransportExecFileCallback,
  ): TransportProcess;
  execFile(
    file: string,
    args: readonly string[],
    options?: TransportExecFileOptions,
    callback?: TransportExecFileCallback,
  ): TransportProcess;
  execFile(
    file: string,
    argsOrOptionsOrCallback?:
      | readonly string[]
      | TransportExecFileOptions
      | TransportExecFileCallback,
    optionsOrCallback?: TransportExecFileOptions | TransportExecFileCallback,
    maybeCallback?: TransportExecFileCallback,
  ): TransportProcess {
    const { args, options, callback } = execFileArguments(
      argsOrOptionsOrCallback,
      optionsOrCallback,
      maybeCallback,
    );
    const { surviveAfterOctoExit, ...execOptions } = options;
    const localProcess = this.manage(
      execFile(
        file,
        args,
        {
          cwd: this.cwd,
          env: commandEnvironment(),
          ...execOptions,
        },
        callback ?? null,
      ),
      { surviveAfterOctoExit },
    );
    localProcess.on("error", () => {});
    return localProcess;
  }

  private manage(
    childProcess: ChildProcess,
    options: { detached?: boolean; surviveAfterOctoExit?: boolean },
  ): TransportProcess {
    const localProcess = new ChildTransportProcess(childProcess, options);
    this.runningProcesses.add(localProcess);
    this.processManager.register({
      cleanup: options => localProcess.terminate(options),
      processClosedPromise: localProcess.processClosedPromise,
      surviveAfterOctoExit: options.surviveAfterOctoExit,
    });
    void localProcess.processClosedPromise.then(() => this.runningProcesses.delete(localProcess));
    return localProcess;
  }

  async writeFile(_: AbortSignal, file: string, contents: string) {
    return await fs.writeFile(file, contents, "utf8");
  }

  async readFile(_: AbortSignal, file: string) {
    return await fs.readFile(file, "utf8");
  }

  async modTime(_: AbortSignal, file: string) {
    try {
      const stat = await fs.stat(file);
      return stat.mtimeMs;
    } catch (e) {
      throw new TransportError(`Could not get modified time for ${file}: ${e}`);
    }
  }

  async resolvePath(_: AbortSignal, file: string) {
    try {
      return await fs.realpath(file);
    } catch {
      return path.resolve(file);
    }
  }

  async mkdir(_: AbortSignal, dirpath: string) {
    await fs.mkdir(dirpath, { recursive: true });
  }

  async readdir(_: AbortSignal, dirpath: string) {
    const entries = await fs.readdir(dirpath, { withFileTypes: true });
    return Promise.all(
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
    );
  }

  async pathExists(signal: AbortSignal, file: string) {
    try {
      await this.modTime(signal, file);
      return true;
    } catch {
      return false;
    }
  }

  async isDirectory(_: AbortSignal, file: string) {
    try {
      const stat = await fs.stat(file);
      return stat.isDirectory();
    } catch {
      return false;
    }
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
