import {
  Transport,
  TransportError,
  CommandFailedError,
  runShell,
  runBackgroundShell,
  createPollingFileWatcher,
  type FsWatcher,
  type BackgroundShellOptions,
} from "../libocto/transport.ts";
import { ProcessManager, processes } from "../process-manager.ts";
import { spawn, execFile, type ChildProcess } from "child_process";
import { posix } from "path";
import * as logger from "../logger.ts";
import { err, errorToString, ok, type Result } from "../libocto/result.ts";
import { quote } from "shell-quote";
import {
  TransportProcess,
  type ProcessSpawnOptions,
  type ProcessExecFileOptions,
  type ProcessExecFileCallback,
} from "../libocto/transport.ts";

export async function manageContainer(args: string[]) {
  const processManager = processes.manager();
  logger.log("info", "Spawning Docker container...");

  const { stdout } = await new Promise<{
    stdout: string;
  }>((resolve, reject) => {
    const stdout: string[] = [];
    let error = false;
    const dockerRunProcess = manageDockerCli(
      spawn("docker", ["run", ...args], { stdio: ["ignore", "pipe", "inherit"] }),
      processManager,
      {},
    );
    if (!dockerRunProcess.stdout) {
      reject(new Error("Failed to spawn docker process with piped stdout"));
      return;
    }
    dockerRunProcess.on("error", e => {
      error = true;
      reject(e);
    });
    dockerRunProcess.stdout.on("data", data => stdout.push(data));
    dockerRunProcess.on("close", code => {
      if (code != null && code !== 0) {
        if (!error) reject("Command exited with non-zero exit code: " + code);
      } else if (!error) {
        resolve({
          stdout: stdout.join(""),
        });
      }
    });
  });

  const name = stdout.trim();
  let containerKillPromise: Promise<void> | undefined;
  const killContainer = () => {
    containerKillPromise ??= (async () => {
      try {
        await runDockerCommand(["kill", name], processManager, {
          timeout: 5000,
          surviveAfterOctoExit: true,
        });
      } catch (error) {
        logger.error("info", `Failed to stop Docker container ${name}:`, error);
      }
    })();
    return containerKillPromise;
  };
  const unregisterCleanup = processManager.registerOctoExitCleanup(killContainer);
  return {
    container: name,
    close: async () => {
      await killContainer();
      unregisterCleanup();
    },
  };
}

function randomSuffix() {
  return `${Date.now()}_${Math.random().toString(16)}`;
}

// inotifywait with --format '%w%f' prints the full path; busybox inotifyd prints
// `events\twatched_dir[\tsubfile]`.
function parseWatcherEventPath(binary: "inotifywait" | "busybox", line: string): string | null {
  if (binary === "inotifywait") return line;
  const parts = line.split("\t");
  if (parts.length < 2 || parts[1] === "") return null;
  return parts.length >= 3 && parts[2] !== "" ? `${parts[1]}/${parts[2]}` : parts[1];
}

function runDockerCommand(
  args: readonly string[],
  processManager: ProcessManager,
  options: { timeout: number; surviveAfterOctoExit: boolean },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "docker",
      args,
      { timeout: options.timeout, killSignal: "SIGKILL", encoding: "utf8" },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
    const dockerCliProcess = manageDockerCli(child, processManager, options);
    dockerCliProcess.on("error", () => {});
  });
}

function manageDockerCli(
  child: ChildProcess,
  processManager: ProcessManager,
  options: ProcessSpawnOptions,
): TransportProcess {
  const dockerCliProcess = new TransportProcess(child, {
    detached: options.detached,
    surviveAfterOctoExit: options.surviveAfterOctoExit,
  });
  processManager.register(dockerCliProcess);
  return dockerCliProcess;
}

type DockerTarget =
  | {
      type: "container";
      container: string;
    }
  | {
      type: "image";
      image: Awaited<ReturnType<typeof manageContainer>>;
    };

export class DockerTransport implements Transport {
  private readonly _container: string;
  cwd: string;
  readonly commandShell = "/bin/sh";
  private readonly runningProcesses = new Set<TransportProcess>();

  private constructor(
    private readonly _target: DockerTarget,
    cwd: string,
    private readonly processManager: ProcessManager,
  ) {
    if (this._target.type === "image") this._container = this._target.image.container;
    else this._container = this._target.container;
    this.cwd = cwd;
  }

  static async create(target: DockerTarget): Promise<DockerTransport> {
    const processManager = processes.manager();
    const container = target.type === "image" ? target.image.container : target.container;
    const cwd = await runDockerCommand(
      ["exec", container, "/bin/sh", "-c", "pwd"],
      processManager,
      {
        timeout: 5000,
        surviveAfterOctoExit: false,
      },
    );
    return new DockerTransport(target, cwd.trim(), processManager);
  }

  async close() {
    const closables = [...this.runningProcesses].map(dockerProcess =>
      dockerProcess.terminate({ graceMs: 500 }),
    );
    if (this._target.type === "image") closables.push(this._target.image.close());
    await Promise.all(closables);
  }

  spawn(command: string, args: readonly string[], options: ProcessSpawnOptions): TransportProcess {
    return this.manage(
      spawn("docker", this.commandArgs(command, args, options), {
        stdio: options.stdio ?? "pipe",
        timeout: options.timeout,
        detached: options.detached,
      }),
      options,
    );
  }

  private commandArgs(
    command: string,
    args: readonly string[],
    options: ProcessSpawnOptions,
  ): string[] {
    const dockerArgs = ["exec", "-i"];
    for (const [name, value] of Object.entries(options.env ?? {})) {
      if (value != null) dockerArgs.push("--env", `${name}=${value}`);
    }
    dockerArgs.push(this._container, command, ...args);
    return dockerArgs;
  }

  private manage(child: ChildProcess, options: ProcessSpawnOptions): TransportProcess {
    const dockerProcess = manageDockerCli(child, this.processManager, options);
    this.runningProcesses.add(dockerProcess);
    void dockerProcess.processClosedPromise.then(() => {
      this.runningProcesses.delete(dockerProcess);
    });
    return dockerProcess;
  }

  execFile(
    file: string,
    args: readonly string[],
    options: ProcessExecFileOptions,
    callback: ProcessExecFileCallback | undefined,
  ): TransportProcess {
    const { env, ...execOptions } = options;
    const execFileProcess = this.manage(
      execFile(
        "docker",
        this.commandArgs(file, args, { env }),
        { ...execOptions, encoding: "utf8" },
        callback,
      ),
      {},
    );
    execFileProcess.on("error", () => {});
    return execFileProcess;
  }

  private async dockerExec(
    signal: AbortSignal,
    command: string[],
    timeout: number,
  ): Promise<Result<string, TransportError>> {
    return this.shell(signal, command.length === 1 ? command[0] : quote(command), timeout);
  }

  // `test` exits 1 when the check is false and 2 on an internal error; other dockerExec
  // failures (dead container, timeout, abort) have no exit code.
  private async runTest(
    signal: AbortSignal,
    args: string[],
    file: string,
    errorContext: string,
  ): Promise<Result<boolean, string>> {
    const result = await this.dockerExec(signal, args, 5000);
    if (result.success) return ok(true);
    if (result.error instanceof CommandFailedError && result.error.exitCode === 1) {
      return ok(false);
    }
    return err(`Could not ${errorContext} ${file}: ${errorToString(result.error)}`);
  }

  async writeFile(
    signal: AbortSignal,
    file: string,
    contents: string,
  ): Promise<Result<null, string>> {
    // Create a temporary file with the contents
    const tempFile = `/tmp/octo_write_${randomSuffix()}`;

    // First, write the contents to the temp file using a base64 to avoid shellescape issues
    const base64Contents = Buffer.from(contents).toString("base64");

    const written = await this.dockerExec(
      signal,
      [`echo '${base64Contents}' | base64 -d > '${tempFile}'`],
      5000,
    );
    if (!written.success) {
      return err(`Could not write file ${file}: ${errorToString(written.error)}`);
    }

    // Ensure directory exists
    const dirPath = file.substring(0, file.lastIndexOf("/"));
    if (dirPath) {
      const prepared = await this.mkdir(signal, dirPath);
      if (!prepared.success) {
        await this.dockerExec(signal, ["rm", "-f", tempFile], 5000);
        return err(`Could not write file ${file}: ${prepared.error}`);
      }
    }

    // Move the temp file to the target location
    const moved = await this.dockerExec(signal, ["mv", tempFile, file], 5000);
    if (!moved.success) {
      // Clean up temp file if anything fails
      await this.dockerExec(signal, ["rm", "-f", tempFile], 5000);
      return err(`Could not write file ${file}: ${errorToString(moved.error)}`);
    }
    return ok(null);
  }

  async readFile(signal: AbortSignal, file: string): Promise<Result<string, string>> {
    const output = await this.dockerExec(signal, ["cat", file], 10000);
    if (!output.success) return err(`Could not read file ${file}: ${errorToString(output.error)}`);
    return ok(output.data);
  }

  async modTime(signal: AbortSignal, file: string): Promise<Result<number, string>> {
    const output = await this.dockerExec(signal, ["stat", "-c", "%Y", file], 5000);
    if (!output.success) {
      return err(`Could not get modified time for ${file}: ${errorToString(output.error)}`);
    }
    const timestamp = parseInt(output.data.trim());
    if (Number.isNaN(timestamp)) {
      return err(`Could not parse modified time for ${file}: ${output.data.trim()}`);
    }
    // Convert seconds to milliseconds
    return ok(timestamp * 1000);
  }

  async resolvePath(signal: AbortSignal, path: string): Promise<Result<string, string>> {
    const output = await this.dockerExec(signal, ["readlink", "-f", path], 5000);
    if (!output.success) {
      return err(`Could not resolve path ${path}: ${errorToString(output.error)}`);
    }
    return ok(output.data.trim());
  }

  async mkdir(signal: AbortSignal, dirpath: string): Promise<Result<null, string>> {
    const result = await this.dockerExec(signal, ["mkdir", "-p", dirpath], 5000);
    if (!result.success) {
      return err(`Could not create directory ${dirpath}: ${errorToString(result.error)}`);
    }
    return ok(null);
  }

  async readdir(
    signal: AbortSignal,
    dirpath: string,
  ): Promise<Result<Array<{ entry: string; isDirectory: boolean }>, string>> {
    const output = await this.dockerExec(signal, ["ls", "-la", dirpath], 5000);
    if (!output.success) {
      return err(`Could not read directory ${dirpath}: ${errorToString(output.error)}`);
    }
    const lines = output.data.trim().split("\n").slice(1); // Skip "total" line

    const entries = [];
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 9) continue;

      const permissions = parts[0];
      const name = parts[8];

      // Skip "." and ".." entries
      if (name === "." || name === "..") continue;

      const isDirectory = permissions.startsWith("d");
      entries.push({
        entry: name,
        isDirectory,
      });
    }

    return ok(entries);
  }

  async pathExists(signal: AbortSignal, file: string): Promise<Result<boolean, string>> {
    return this.runTest(signal, ["test", "-e", file], file, "stat");
  }

  async isDirectory(signal: AbortSignal, file: string): Promise<Result<boolean, string>> {
    return this.runTest(signal, ["test", "-d", file], file, "stat");
  }

  backgroundShell(options: BackgroundShellOptions) {
    return runBackgroundShell(this, options);
  }

  // inotifywait comes from inotify-tools (debian-ish images); busybox inotifyd is present on
  // alpine/busybox images. With PROG="-", inotifyd streams events to stdout.
  private fileWatcherBinary: "inotifywait" | "busybox" | null | undefined;

  private async detectFileWatcherBinary(
    signal: AbortSignal,
  ): Promise<"inotifywait" | "busybox" | null> {
    if (this.fileWatcherBinary !== undefined) return this.fileWatcherBinary;
    for (const binary of ["inotifywait", "busybox"] as const) {
      const available = await this.shell(signal, `command -v ${binary}`, 5000);
      if (available.success) {
        this.fileWatcherBinary = binary;
        return binary;
      }
    }
    this.fileWatcherBinary = null;
    return null;
  }

  async watchFile(
    signal: AbortSignal,
    file: string,
    onEvent: () => void,
  ): Promise<Result<FsWatcher, string>> {
    // Watch the parent directory and filter for the file: files swapped in by atomic rename
    // (git's HEAD.lock -> HEAD) silently kill file-level inotify watches.
    const dir = posix.dirname(file);
    const binary = await this.detectFileWatcherBinary(signal);
    if (binary == null) {
      return ok(createPollingFileWatcher(this, signal, file, onEvent));
    }

    const command =
      binary === "inotifywait"
        ? `inotifywait -m -e modify,create,delete,moved_to,moved_from --format '%w%f' ${quote([dir])}`
        : `busybox inotifyd - ${quote([dir])}`;
    const watcherProcess = this.spawn(this.commandShell, ["-c", command], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (!watcherProcess.stdout) {
      return err("Failed to spawn filesystem watcher with piped stdout");
    }

    let buffer = "";
    watcherProcess.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line === "") continue;
        if (parseWatcherEventPath(binary, line) === file) onEvent();
      }
    });

    const close = async () => {
      await watcherProcess.terminate({ graceMs: 500 });
    };
    if (signal.aborted) await close();
    else signal.addEventListener("abort", () => void close(), { once: true });
    return ok({ close });
  }

  async shell(
    signal: AbortSignal,
    command: string,
    timeout: number,
  ): Promise<Result<string, TransportError>> {
    return runShell(this, signal, command, timeout);
  }
}
