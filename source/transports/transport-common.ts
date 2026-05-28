import { quote } from "shell-quote";

export type TransportKind = "local" | "docker";

export interface Transport {
  readonly cwd: string;
  readonly transportKind: TransportKind;
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
