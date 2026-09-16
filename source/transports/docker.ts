import { Transport, TransportError } from "./transport-common.ts";
import { ProcessManager, processes } from "../process-manager.ts";
import { BackgroundProcessManager } from "../background-process.ts";
import { spawn, execFile, type ChildProcess } from "child_process";
import * as logger from "../logger.ts";
import { quote } from "shell-quote";
import { runShell } from "./shell.ts";
import {
  TransportProcess,
  type ProcessSpawnOptions,
  type ProcessExecFileOptions,
  type ProcessExecFileCallback,
} from "./transport-process.ts";

export async function manageContainer(args: string[]) {
  const processManager = processes.manager();
  console.log("Spawning Docker container...");

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
        await runDockerCli(["kill", name], processManager, {
          timeout: 5000,
          surviveAfterOctoExit: true,
        });
      } catch (error) {
        logger.error("info", `Failed to stop Docker container ${name}:`, error);
      }
    })();
    return containerKillPromise;
  };
  const unregisterCleanup = processManager.register({
    cleanup: () => killContainer(),
  });
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

function runDockerCli(
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
  });
  processManager.register({
    cleanup: cleanupOptions => dockerCliProcess.terminate(cleanupOptions),
    processClosedPromise: dockerCliProcess.processClosedPromise,
    surviveAfterOctoExit: options.surviveAfterOctoExit,
  });
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
  readonly backgroundProcesses: BackgroundProcessManager;
  private readonly runningProcesses = new Set<TransportProcess>();

  private constructor(
    private readonly _target: DockerTarget,
    cwd: string,
    private readonly processManager: ProcessManager,
  ) {
    if (this._target.type === "image") this._container = this._target.image.container;
    else this._container = this._target.container;
    this.cwd = cwd;
    this.backgroundProcesses = new BackgroundProcessManager(this);
  }

  static async create(target: DockerTarget): Promise<DockerTransport> {
    const processManager = processes.manager();
    const container = target.type === "image" ? target.image.container : target.container;
    const cwd = await runDockerCli(["exec", container, "/bin/sh", "-c", "pwd"], processManager, {
      timeout: 5000,
      surviveAfterOctoExit: false,
    });
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
        killSignal: options.killSignal,
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
    const cwd = options.cwd ?? this.cwd;
    const dockerArgs = ["exec", "-i", "--workdir", cwd];
    for (const [name, value] of Object.entries(options.env ?? {})) {
      if (value != null) dockerArgs.push("--env", `${name}=${value}`);
    }
    const shell = typeof options.shell === "string" ? options.shell : this.commandShell;
    const commandArgs = options.shell
      ? [shell, "-c", [command, ...args].join(" ")]
      : [command, ...args];
    dockerArgs.push(this._container, ...commandArgs);
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
    const { env, shell, surviveAfterOctoExit, ...execOptions } = options;
    const execFileProcess = this.manage(
      execFile(
        "docker",
        this.commandArgs(file, args, { env, shell }),
        execOptions,
        callback ?? null,
      ),
      { surviveAfterOctoExit },
    );
    execFileProcess.on("error", () => {});
    return execFileProcess;
  }

  private async dockerExec(
    signal: AbortSignal,
    command: string[],
    timeout: number,
  ): Promise<string> {
    return this.shell(signal, command.length === 1 ? command[0] : quote(command), timeout);
  }

  async writeFile(signal: AbortSignal, file: string, contents: string): Promise<void> {
    // Create a temporary file with the contents
    const tempFile = `/tmp/octo_write_${randomSuffix()}`;

    // First, write the contents to the temp file using a base64 to avoid shellescape issues
    const base64Contents = Buffer.from(contents).toString("base64");

    await this.dockerExec(signal, [`echo '${base64Contents}' | base64 -d > '${tempFile}'`], 5000);

    try {
      // Ensure directory exists
      const dirPath = file.substring(0, file.lastIndexOf("/"));
      if (dirPath) {
        await this.mkdir(signal, dirPath);
      }

      // Move the temp file to the target location
      await this.dockerExec(signal, ["mv", tempFile, file], 5000);
    } catch (e) {
      // Clean up temp file if anything fails
      try {
        await this.dockerExec(signal, ["rm", "-f", tempFile], 5000);
      } catch {}
      throw e;
    }
  }

  async readFile(signal: AbortSignal, file: string): Promise<string> {
    try {
      const output = await this.dockerExec(signal, ["cat", file], 10000);
      return output;
    } catch (e) {
      throw new TransportError(`Could not read file ${file}: ${e}`);
    }
  }

  async modTime(signal: AbortSignal, file: string): Promise<number> {
    try {
      const output = await this.dockerExec(signal, ["stat", "-c", "%Y", file], 5000);
      const timestamp = parseInt(output.trim());
      return timestamp * 1000; // Convert seconds to milliseconds
    } catch (e) {
      throw new TransportError(`Could not get modified time for ${file}: ${e}`);
    }
  }

  async resolvePath(signal: AbortSignal, path: string): Promise<string> {
    const output = await this.dockerExec(signal, ["readlink", "-f", path], 5000);
    return output.trim();
  }

  async mkdir(signal: AbortSignal, dirpath: string): Promise<void> {
    await this.dockerExec(signal, ["mkdir", "-p", dirpath], 5000);
  }

  async readdir(
    signal: AbortSignal,
    dirpath: string,
  ): Promise<
    Array<{
      entry: string;
      isDirectory: boolean;
    }>
  > {
    try {
      const output = await this.dockerExec(signal, ["ls", "-la", dirpath], 5000);
      const lines = output.trim().split("\n").slice(1); // Skip "total" line

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

      return entries;
    } catch (e) {
      throw new TransportError(`Could not read directory ${dirpath}: ${e}`);
    }
  }

  async pathExists(signal: AbortSignal, file: string): Promise<boolean> {
    try {
      await this.dockerExec(signal, ["test", "-e", file], 5000);
      return true;
    } catch {
      return false;
    }
  }

  async isDirectory(signal: AbortSignal, file: string): Promise<boolean> {
    try {
      await this.dockerExec(signal, ["test", "-d", file], 5000);
      return true;
    } catch {
      return false;
    }
  }

  async shell(signal: AbortSignal, command: string, timeout: number): Promise<string> {
    return runShell(this, signal, command, timeout, this.commandShell);
  }
}
