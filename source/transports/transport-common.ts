import ignore from "ignore";

export interface Transport {
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
  cwd: (signal: AbortSignal) => Promise<string>;
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

export async function globFiles(
  signal: AbortSignal,
  transport: Transport,
  patterns: string[],
  options: { cwd?: string; ignore?: string[] } = {},
): Promise<string[]> {
  const cwd = options.cwd || (await transport.cwd(signal));

  // Build find command with directory pruning
  const pruneArgs = EXCLUDED_DIRS.map(d => `-name ${d} -prune`).join(" -o ");
  const findCmd = `find ${cwd} ${pruneArgs} -o -type f -print`;

  const output = await transport.shell(signal, findCmd, 30000);

  // Parse output and make paths relative to cwd
  const files = output
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

  // Apply ignore patterns
  if (options.ignore && options.ignore.length > 0) {
    const ig = ignore().add(options.ignore);
    return ig.filter(files);
  }

  return files;
}

export class TransportError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = this.constructor.name;
  }
}
export class CommandFailedError extends TransportError {}
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
