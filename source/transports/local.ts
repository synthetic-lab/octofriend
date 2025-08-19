import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { Transport, AbortError, CommandFailedError, TransportError } from "./transport-common.ts";

export class LocalTransport implements Transport {
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
    return path.resolve(file);
  }

  async mkdir(_: AbortSignal, dirpath: string) {
    await fs.mkdir(dirpath, { recursive: true });
  }

  async readdir(_: AbortSignal, dirpath: string) {
    const entries = await fs.readdir(dirpath, {
      withFileTypes: true,
    });
    return entries.map(entry => ({
      entry: entry.name,
      isDirectory: entry.isDirectory(),
    }));
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
      const child = spawn(cmd, {
        cwd: process.cwd(),
        shell: "/bin/bash",
        timeout,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let output = '';
      let aborted = false;

      const onAbort = () => {
        aborted = true;
        // Try graceful termination first
        child.kill('SIGTERM');
        // Fallback to SIGKILL if it doesn't exit quickly
        setTimeout(() => {
          try { child.kill('SIGKILL'); } catch {}
        }, 500).unref?.();
      };

      if (signal.aborted) onAbort();
      signal.addEventListener('abort', onAbort);

      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
      };

      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.stderr.on('data', (data) => {
        output += data.toString();
      });

      child.on('close', (code) => {
        cleanup();
        if (aborted) {
          reject(new AbortError());
          return;
        }
        if (code === 0) {
          resolve(output);
        } else {
          if(code == null) {
            reject(new CommandFailedError(
`Command timed out.
output: ${output}`));
          }
          else {
            reject(new CommandFailedError(
`Command exited with code: ${code}
output: ${output}`));
          }
        }
      });

      child.on('error', (err) => {
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
