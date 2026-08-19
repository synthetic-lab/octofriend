import fs from "fs/promises";
import path from "path";
import {
  Transport,
  AbortError,
  CommandFailedError,
  MAX_SHELL_OUTPUT_LENGTH,
  ShellOutput,
  TransportError,
} from "./transport-common.ts";
import { processes } from "../octo-process.ts";

const KILL_GRACE_MS = 500;

const STRIPPED_ENV_VARS = ["NODE_ENV", "NAPI_RS_NATIVE_LIBRARY_PATH", "CANARY_OCTO"];

export class LocalTransport implements Transport {
  cwd = process.cwd();
  private readonly octoProcessManager = processes.manager();

  async close() {
    this.octoProcessManager.terminateAll({ graceMs: KILL_GRACE_MS });
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
    return new Promise<string>((resolve, reject) => {
      const env = { ...process.env };
      for (const name of STRIPPED_ENV_VARS) delete env[name];

      const octoProcess = this.octoProcessManager.spawn(cmd, {
        cwd: process.cwd(),
        shell: "bash",
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
        env,
      });
      if (!octoProcess.stdout || !octoProcess.stderr) {
        reject(new Error("Failed to spawn shell process with piped stdio"));
        return;
      }

      const output = new ShellOutput();
      let aborted = false;
      let timedOut = false;
      let killed = false;

      function killGroup() {
        if (killed) return;
        killed = true;
        octoProcess.terminate({ graceMs: KILL_GRACE_MS });
      }

      function onAbort() {
        aborted = true;
        killGroup();
      }

      function cleanup() {
        signal.removeEventListener("abort", onAbort);
        clearTimeout(timeoutHandler);
      }

      const timeoutHandler = setTimeout(() => {
        timedOut = true;
        killGroup();
      }, timeout);

      if (signal.aborted) onAbort();
      signal.addEventListener("abort", onAbort);

      octoProcess.stdout.on("data", data => {
        if (!output.append(data)) killGroup();
      });

      octoProcess.stderr.on("data", data => {
        if (!output.append(data)) killGroup();
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
        if (timedOut) {
          reject(
            new CommandFailedError(
              `Command timed out.
output: ${commandOutput}`,
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
                `Command killed by signal.
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
}
