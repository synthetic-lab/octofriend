import { spawn } from "child_process";
import { Transport, AbortError, CommandFailedError, TransportError } from "./transport-common.ts";

type DockerTarget = { type: "container", container: string };

export class DockerTransport implements Transport {
  private _container: string;

  constructor(target: DockerTarget) {
    this._container = target.container;
  }

  async close() {
  }

  private async dockerExec(signal: AbortSignal, command: string[], timeout: number): Promise<string> {
    const dockerCmd = ["docker", "exec", this._container, ...command];

    return new Promise<string>((resolve, reject) => {
      const child = spawn(dockerCmd[0], dockerCmd.slice(1), {
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

  async writeFile(signal: AbortSignal, file: string, contents: string): Promise<void> {
    // Create a temporary file with the contents
    const tempFile = `/tmp/octo_write_${Date.now()}_${Math.random().toString(16)}`;

    // First, write the contents to the temp file using a base64 to avoid shellescape issues
    const base64Contents = Buffer.from(contents).toString('base64');
    await this.dockerExec(signal, [
      "/bin/sh", "-c",
      `echo '${base64Contents}' | base64 -d > '${tempFile}'`
    ], 5000);

    try {
      // Ensure directory exists
      const dirPath = file.substring(0, file.lastIndexOf('/'));
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

  async readdir(signal: AbortSignal, dirpath: string): Promise<Array<{
    entry: string,
    isDirectory: boolean,
  }>> {
    try {
      const output = await this.dockerExec(signal, ["ls", "-la", dirpath], 5000);
      const lines = output.trim().split('\n').slice(1); // Skip "total" line

      const entries = [];
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 9) continue;

        const permissions = parts[0];
        const name = parts[8];

        // Skip "." and ".." entries
        if (name === '.' || name === '..') continue;

        const isDirectory = permissions.startsWith('d');
        entries.push({
          entry: name,
          isDirectory
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
