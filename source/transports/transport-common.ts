import { quote } from "shell-quote";
import { type Result, ok, err, errorToString } from "../libocto/result.ts";
import type {
  TransportProcess,
  ProcessSpawnOptions,
  ProcessExecFileOptions,
  ProcessExecFileCallback,
} from "./transport-process.ts";
import type { BackgroundProcess, BackgroundProcessManager } from "../background-process.ts";

export const MAX_SHELL_OUTPUT_LENGTH = 100_000_000;

export class ShellOutput {
  private readonly chunks: string[] = [];
  private length = 0;
  private exceededLimit = false;
  private drainedChunkCount = 0;

  constructor(maxLength = MAX_SHELL_OUTPUT_LENGTH) {
    if (!Number.isSafeInteger(maxLength) || maxLength < 1) {
      throw new RangeError("maxLength must be a positive safe integer");
    }
    this.maxLength = maxLength;
  }

  private readonly maxLength: number;

  append(chunk: string | Buffer): boolean {
    if (this.exceededLimit) return false;
    const value = chunk.toString();
    if (value.length > this.maxLength - this.length) {
      this.exceededLimit = true;
      this.chunks.length = 0;
      this.length = 0;
      this.drainedChunkCount = 0;
      return false;
    }
    this.chunks.push(value);
    this.length += value.length;
    return true;
  }

  getOutput(): string | null {
    if (this.exceededLimit) return null;
    return this.chunks.join("");
  }

  hasUndrainedOutput(): boolean {
    return !this.exceededLimit && this.drainedChunkCount < this.chunks.length;
  }

  drainNewOutput(): string {
    if (this.exceededLimit || this.drainedChunkCount >= this.chunks.length) return "";
    const output = this.chunks.slice(this.drainedChunkCount).join("");
    this.drainedChunkCount = this.chunks.length;
    return output;
  }
}

export type BackgroundShellOptions = {
  command: string;
  label: string;
  signal: AbortSignal;
  backgroundProcessManager: BackgroundProcessManager;
};

export interface Transport {
  readonly cwd: string;
  readonly commandShell: string;
  backgroundShell(options: BackgroundShellOptions): Result<BackgroundProcess, TransportError>;
  spawn(command: string, args: readonly string[], options: ProcessSpawnOptions): TransportProcess;
  execFile(
    file: string,
    args: readonly string[],
    options: ProcessExecFileOptions,
    callback: ProcessExecFileCallback | undefined,
  ): TransportProcess;
  writeFile: (signal: AbortSignal, file: string, contents: string) => Promise<void>;
  readFile: (signal: AbortSignal, file: string) => Promise<string>;
  pathExists: (signal: AbortSignal, file: string) => Promise<boolean>;
  isDirectory: (signal: AbortSignal, file: string) => Promise<boolean>;
  mkdir: (signal: AbortSignal, dirpath: string) => Promise<void>;
  readdir: (
    signal: AbortSignal,
    dirpath: string,
  ) => Promise<
    Array<{
      entry: string;
      isDirectory: boolean;
    }>
  >;
  modTime: (signal: AbortSignal, file: string) => Promise<number>;
  resolvePath: (signal: AbortSignal, path: string) => Promise<string>;
  shell: (signal: AbortSignal, command: string, timeout: number) => Promise<string>;
  close: () => Promise<void>;
}

const EXCLUDED_DIRS = [
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  ".vscode",
  ".idea",
  "dist",
  "build",
  "out",
  ".next",
  "target",
  "bin",
  "obj",
  ".turbo",
  ".output",
  "__pycache__",
  ".pytest_cache",
  ".cache",
  "bower_components",
  ".pnpm-store",
  "vendor",
  ".npm",
  ".sst",
  ".webkit-cache",
  "mypy_cache",
  ".history",
  ".gradle",
];

export async function findFiles(
  signal: AbortSignal,
  transport: Transport,
  options: {
    path?: string; // The directory to search from (defaults to transport.cwd)
    includeName?: string; // -name pattern (e.g. "*.js")
    includePath?: string; // -path pattern (e.g. "*/test/*")
    excludeName?: string; // ! -name pattern
    excludePath?: string; // ! -path pattern
    caseInsensitive?: boolean; // use -iname instead of -name
    type?: "f" | "d"; // -type f or -type d
    maxDepth?: number; // -maxdepth N
    maxResults?: number; // cap output count
  } = {},
): Promise<string[]> {
  const cwd = options.path || transport.cwd;

  // Build find command with directory pruning
  const pruneArgs = EXCLUDED_DIRS.map(d => `-name ${quote([d])} -prune`).join(" -o ");

  // Build safe find predicates with proper shell escaping
  const predicates: string[] = [];

  if (
    options.maxDepth !== undefined &&
    Number.isInteger(options.maxDepth) &&
    options.maxDepth >= 0
  ) {
    predicates.push(`-maxdepth ${options.maxDepth}`);
  }

  if (options.includeName !== undefined) {
    const nameFlag = options.caseInsensitive ? "-iname" : "-name";
    predicates.push(`${nameFlag} ${quote([options.includeName])}`);
  }

  if (options.includePath !== undefined) {
    predicates.push(`-path ${quote([options.includePath])}`);
  }

  if (options.excludeName !== undefined) {
    predicates.push(`! -name ${quote([options.excludeName])}`);
  }

  if (options.excludePath !== undefined) {
    predicates.push(`! -path ${quote([options.excludePath])}`);
  }

  if (options.type === "f" || options.type === "d") {
    predicates.push(`-type ${options.type}`);
  } else {
    // Default to -type f if no type specified
    predicates.push("-type f");
  }

  const findCmd = `find ${quote([cwd])} ${pruneArgs} -o ${predicates.join(" ")} -print`;

  const output = await transport.shell(signal, findCmd, 30000);

  // Parse output and make paths relative to cwd
  let results = output
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(fullPath => {
      if (fullPath.startsWith(cwd + "/")) {
        return fullPath.slice(cwd.length + 1);
      }
      if (fullPath === cwd) {
        return ".";
      }
      return fullPath;
    });

  if (options.maxResults !== undefined && options.maxResults > 0) {
    results = results.slice(0, options.maxResults);
  }

  return results;
}

export class TransportError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = this.constructor.name;
  }
}
export class CommandFailedError extends TransportError {
  exitCode?: number;
  constructor(msg: string, exitCode?: number) {
    super(msg);
    this.exitCode = exitCode;
  }
}
export class AbortError extends TransportError {
  constructor() {
    super("Aborted");
  }
}

export async function getEnvVar(
  signal: AbortSignal,
  transport: Transport,
  envVarName: string,
  timeout: number,
): Promise<string> {
  return (await transport.shell(signal, "echo $" + envVarName, timeout)).replace(/\n$/, "");
}

const KILL_GRACE_MS = 500;

export function runShell(
  transport: Transport,
  signal: AbortSignal,
  cmd: string,
  timeout: number,
): Promise<string> {
  if (signal.aborted) return Promise.reject(new AbortError());
  return new Promise<string>((resolve, reject) => {
    const shellProcess = transport.spawn(transport.commandShell, ["-c", cmd], {
      cwd: transport.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    if (!shellProcess.stdout || !shellProcess.stderr) {
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
      shellProcess.terminate({ graceMs: KILL_GRACE_MS });
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

    shellProcess.stdout.on("data", data => {
      if (!output.append(data)) killGroup();
    });

    shellProcess.stderr.on("data", data => {
      if (!output.append(data)) killGroup();
    });

    shellProcess.on("close", code => {
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

    shellProcess.on("error", err => {
      cleanup();
      if (aborted) {
        reject(new AbortError());
        return;
      }
      reject(new CommandFailedError(`Command failed: ${err.message}`));
    });
  });
}

export function runBackgroundShell(
  transport: Transport,
  { command, label, signal, backgroundProcessManager }: BackgroundShellOptions,
): Result<BackgroundProcess, TransportError> {
  if (signal.aborted) return err(new AbortError());
  let process: TransportProcess;
  try {
    process = transport.spawn(transport.commandShell, ["-c", command], {
      cwd: transport.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
  } catch (error) {
    return err(
      new CommandFailedError(`Failed to spawn background process: ${errorToString(error)}`),
    );
  }
  return ok(backgroundProcessManager.track(process, label, command));
}
