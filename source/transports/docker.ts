import { Transport, TransportError } from "./transport-common.ts";
import { ProcessManager, processes } from "../process-manager.ts";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { quote } from "shell-quote";
import { runShell } from "./shell.ts";
import {
  ChildTransportProcess,
  type TransportProcess,
  type TransportSpawnOptions,
  type TransportExecFileOptions,
  type TransportExecFileCallback,
  spawnArguments,
  execFileArguments,
  collectExecFileOutput,
} from "./transport-process.ts";

export async function manageContainer(args: string[], processManager = processes.manager()) {
  console.log("Spawning Docker container...");

  const { stdout } = await new Promise<{
    stdout: string;
  }>((resolve, reject) => {
    const stdout: string[] = [];
    let error = false;
    const dockerRunProcess = spawnDockerCli(["run", ...args], processManager, {
      stdio: ["ignore", "pipe", "inherit"],
    });
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
      const dockerKillProcess = spawnDockerCli(["kill", name], processManager, {
        stdio: "ignore",
        timeout: 5000,
        killSignal: "SIGKILL",
        surviveAfterOctoExit: true,
      });
      dockerKillProcess.on("error", () => {});
      await dockerKillProcess.processClosedPromise;
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

  static async create(
    target: DockerTarget,
    processManager: ProcessManager = processes.manager(),
  ): Promise<DockerTransport> {
    const container = target.type === "image" ? target.image.container : target.container;
    const cwd = await runDockerCli(
      ["exec", container, "/bin/sh", "-c", "pwd"],
      processManager,
      5000,
    );
    return new DockerTransport(target, cwd.trim(), processManager);
  }

  async close() {
    await Promise.all([
      this._target.type === "image" ? this._target.image.close() : Promise.resolve(),
      ...[...this.runningProcesses].map(dockerProcess => dockerProcess.terminate({ graceMs: 500 })),
    ]);
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
    const cwd =
      typeof options.cwd === "string" || options.cwd == null
        ? (options.cwd ?? this.cwd)
        : fileURLToPath(options.cwd);
    const dockerArgs = ["exec", "-i", "--workdir", cwd];
    for (const [name, value] of Object.entries(options.env ?? {})) {
      if (value != null) dockerArgs.push("--env", `${name}=${value}`);
    }
    if (options.uid != null) {
      dockerArgs.push(
        "--user",
        options.gid == null ? `${options.uid}` : `${options.uid}:${options.gid}`,
      );
    }
    const shell = typeof options.shell === "string" ? options.shell : "/bin/sh";
    const commandArgs = options.shell
      ? [shell, "-c", [command, ...args].join(" ")]
      : [command, ...args];
    dockerArgs.push(this._container, "/bin/sh", "-c", commandArgs.join(" "));
    const dockerProcess = new ChildTransportProcess(
      spawn("docker", dockerArgs, {
        stdio: options.stdio ?? "pipe",
        windowsHide: options.windowsHide,
        timeout: options.timeout,
        killSignal: options.killSignal,
        signal: options.signal,
      }),
    );
    this.runningProcesses.add(dockerProcess);
    this.processManager.register({
      cleanup: options => dockerProcess.terminate(options),
      processClosedPromise: dockerProcess.processClosedPromise,
      surviveAfterOctoExit: options.surviveAfterOctoExit,
    });
    void dockerProcess.processClosedPromise.then(() => {
      this.runningProcesses.delete(dockerProcess);
    });
    return dockerProcess;
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
    const execFileProcess = this.spawn(file, args, { ...options, stdio: "pipe" });
    collectExecFileOutput(execFileProcess, file, args, options, callback);
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
    return runShell(this, signal, command, timeout, "/bin/sh");
  }
}

function spawnDockerCli(
  args: readonly string[],
  processManager: ProcessManager,
  options: TransportSpawnOptions,
): TransportProcess {
  const { surviveAfterOctoExit, ...spawnOptions } = options;
  const dockerCliProcess = new ChildTransportProcess(spawn("docker", args, spawnOptions), {
    detached: options.detached,
  });
  processManager.register({
    cleanup: cleanupOptions => dockerCliProcess.terminate(cleanupOptions),
    processClosedPromise: dockerCliProcess.processClosedPromise,
    surviveAfterOctoExit,
  });
  return dockerCliProcess;
}

function runDockerCli(
  args: readonly string[],
  processManager: ProcessManager,
  timeout: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const dockerCliProcess = spawnDockerCli(args, processManager, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout,
      killSignal: "SIGKILL",
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    dockerCliProcess.stdout?.on("data", chunk => stdout.push(Buffer.from(chunk)));
    dockerCliProcess.stderr?.on("data", chunk => stderr.push(Buffer.from(chunk)));
    dockerCliProcess.on("error", reject);
    dockerCliProcess.on("close", code => {
      if (code === 0) resolve(Buffer.concat(stdout).toString());
      else
        reject(
          new Error(`docker command failed with code ${code}: ${Buffer.concat(stderr).toString()}`),
        );
    });
  });
}
