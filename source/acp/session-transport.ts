import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import {
  Transport,
  AbortError,
  CommandFailedError,
  TransportError,
} from "../transports/transport-common.ts";

function toAbsolute(root: string, target: string) {
  if (path.isAbsolute(target)) return target;
  return path.resolve(root, target);
}

export class SessionTransport implements Transport {
  constructor(private readonly root: string) {}

  async cwd() {
    return this.root;
  }

  async close() {}

  async writeFile(_: AbortSignal, file: string, contents: string) {
    return await fs.writeFile(toAbsolute(this.root, file), contents, "utf8");
  }

  async readFile(_: AbortSignal, file: string) {
    return await fs.readFile(toAbsolute(this.root, file), "utf8");
  }

  async modTime(_: AbortSignal, file: string) {
    try {
      const stat = await fs.stat(toAbsolute(this.root, file));
      return stat.mtimeMs;
    } catch (e) {
      throw new TransportError(`Could not get modified time for ${file}: ${e}`);
    }
  }

  async resolvePath(_: AbortSignal, file: string) {
    const resolved = toAbsolute(this.root, file);
    try {
      return await fs.realpath(resolved);
    } catch {
      return path.resolve(resolved);
    }
  }

  async mkdir(_: AbortSignal, dirpath: string) {
    await fs.mkdir(toAbsolute(this.root, dirpath), { recursive: true });
  }

  async readdir(_: AbortSignal, dirpath: string) {
    const absoluteDir = toAbsolute(this.root, dirpath);
    const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    return Promise.all(
      entries.map(async entry => {
        if (entry.isSymbolicLink()) {
          const fullPath = path.join(absoluteDir, entry.name);
          try {
            const stat = await fs.stat(fullPath);
            return { entry: entry.name, isDirectory: stat.isDirectory() };
          } catch {
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
      const stat = await fs.stat(toAbsolute(this.root, file));
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  async shell(signal: AbortSignal, cmd: string, timeout: number) {
    return new Promise<string>((resolve, reject) => {
      const child = spawn(cmd, {
        cwd: this.root,
        shell: "bash",
        timeout,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });

      let output = "";
      let aborted = false;

      const onAbort = () => {
        aborted = true;
        try {
          process.kill(-child.pid!, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }

        setTimeout(() => {
          try {
            process.kill(-child.pid!, "SIGKILL");
          } catch {
            try {
              child.kill("SIGKILL");
            } catch {}
          }
        }, 500).unref?.();
      };

      if (signal.aborted) onAbort();
      signal.addEventListener("abort", onAbort);

      const cleanup = () => {
        signal.removeEventListener("abort", onAbort);
      };

      child.stdout.on("data", data => {
        output += data.toString();
      });

      child.stderr.on("data", data => {
        output += data.toString();
      });

      child.on("close", code => {
        cleanup();
        if (aborted) {
          reject(new AbortError());
          return;
        }
        if (code === 0) {
          resolve(output);
          return;
        }

        if (code == null) {
          reject(
            new CommandFailedError(
              `Command timed out.
output: ${output}`,
            ),
          );
          return;
        }

        reject(
          new CommandFailedError(
            `Command exited with code: ${code}
output: ${output}`,
          ),
        );
      });

      child.on("error", err => {
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
