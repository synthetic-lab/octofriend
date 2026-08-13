import {
  Transport,
  AbortError,
  CommandFailedError,
  MAX_SHELL_OUTPUT_LENGTH,
  ShellOutput,
  TransportError,
} from "./transport-common.ts";
import { OctoProcessManager, registerCleanup } from "../octo-process.ts";

export async function manageContainer(args: string[]) {
  console.log("Spawning Docker container...");

  const octoProcessManager = new OctoProcessManager();
  const { stdout } = await new Promise<{
    stdout: string;
  }>((resolve, reject) => {
    const stdout: string[] = [];
    let error = false;
    const octoProcess = octoProcessManager.spawn("docker", ["run", ...args], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    if (!octoProcess.stdout) {
      reject(new Error("Failed to spawn docker process with piped stdout"));
      return;
    }
    octoProcess.on("error", e => {
      error = true;
      reject(e);
    });
    octoProcess.stdout.on("data", data => stdout.push(data));
    octoProcess.on("close", code => {
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
  const killContainer = () => {
    try {
      const octoProcess = octoProcessManager.spawn("docker", ["kill", name], { stdio: "ignore" });
      octoProcess.unref();
    } catch {}
  };
  const unregisterCleanup = registerCleanup(killContainer);
  let closed = false;
  return {
    container: name,
    close: async () => {
      if (closed) return;
      closed = true;
      unregisterCleanup();
      killContainer();
    },
  };
}

function randomSuffix() {
  return `${Date.now()}_${Math.random().toString(16)}`;
}

async function runDockerCommand(
  container: string,
  command: string[],
  timeout: number,
  signal: AbortSignal,
): Promise<string> {
  const dockerCmd = ["docker", "exec", container, "/bin/sh", "-c", command.join(" ")];

  return new Promise<string>((resolve, reject) => {
    const octoProcess = new OctoProcessManager().spawn(dockerCmd[0], dockerCmd.slice(1), {
      timeout,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (!octoProcess.stdout || !octoProcess.stderr) {
      reject(new Error("Failed to spawn docker process with piped stdio"));
      return;
    }

    const output = new ShellOutput();
    let aborted = false;
    let killed = false;

    const killChild = () => {
      if (killed) return;
      killed = true;
      octoProcess.terminate({ graceMs: 500 });
    };

    const onAbort = () => {
      aborted = true;
      killChild();
    };

    if (signal.aborted) onAbort();
    signal.addEventListener("abort", onAbort);

    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
    };

    octoProcess.stdout.on("data", data => {
      if (!output.append(data)) killChild();
    });

    octoProcess.stderr.on("data", data => {
      if (!output.append(data)) killChild();
    });

    octoProcess.on("close", code => {
      cleanup();
      if (aborted) {
        reject(new AbortError());
        return;
      }
      const commandOutput = output.getOutput();
      if (commandOutput == null) {
        reject(
          new CommandFailedError(
            `Command output exceeded the ${MAX_SHELL_OUTPUT_LENGTH} character limit and was terminated.`,
          ),
        );
        return;
      }
      if (code === 0) {
        resolve(commandOutput);
      } else {
        if (code == null) {
          reject(
            new CommandFailedError(
              `Command timed out.
output: ${commandOutput}`,
            ),
          );
        } else {
          reject(
            new CommandFailedError(
              `Command exited with code: ${code}
output: ${commandOutput}`,
              code,
            ),
          );
        }
      }
    });

    octoProcess.on("error", err => {
      cleanup();
      if (aborted) {
        reject(new AbortError());
        return;
      }
      reject(new CommandFailedError(`Command failed: ${err.message}`));
    });
  });
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

  private constructor(
    private readonly _target: DockerTarget,
    cwd: string,
  ) {
    if (this._target.type === "image") this._container = this._target.image.container;
    else this._container = this._target.container;
    this.cwd = cwd;
  }

  static async create(target: DockerTarget): Promise<DockerTransport> {
    const container = target.type === "image" ? target.image.container : target.container;
    const cwd = await runDockerCommand(container, ["pwd"], 5000, new AbortController().signal);
    return new DockerTransport(target, cwd.trim());
  }

  async close() {
    if (this._target.type === "image") await this._target.image.close();
  }

  private async dockerExec(
    signal: AbortSignal,
    command: string[],
    timeout: number,
  ): Promise<string> {
    return runDockerCommand(this._container, command, timeout, signal);
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
    return await this.dockerExec(signal, [command], timeout);
  }
}
