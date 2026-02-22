import { Transport } from "../transports/transport-common.ts";

type WalkerCallback = (entry: {
  path: string;
  name: string;
  isDirectory: boolean;
  resolvedBase: string;
}) => void | boolean | Promise<void | boolean>;

export async function walkDirectory(
  signal: AbortSignal,
  transport: Transport,
  dirPath: string,
  callback: WalkerCallback,
): Promise<void> {
  const visited = new Set<string>();
  await walkRecursive(signal, transport, dirPath, callback, visited);
}

async function walkRecursive(
  signal: AbortSignal,
  transport: Transport,
  dirPath: string,
  callback: WalkerCallback,
  visited: Set<string>,
): Promise<void> {
  const resolved = await transport.resolvePath(signal, dirPath);
  if (visited.has(resolved)) return;
  visited.add(resolved);

  const entries = await transport.readdir(signal, dirPath);

  for (const entry of entries) {
    if (signal.aborted) {
      throw new Error("Aborted");
    }

    const fullPath = await transport.resolvePath(signal, dirPath + "/" + entry.entry);

    const shouldContinue = await callback({
      path: fullPath,
      name: entry.entry,
      isDirectory: entry.isDirectory,
      resolvedBase: resolved,
    });

    if (entry.isDirectory && shouldContinue !== false) {
      await walkRecursive(signal, transport, fullPath, callback, visited);
    }
  }
}

export function globToRegex(pattern: string): RegExp {
  let regex = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      regex += ".*";
      i += 2;
    } else if (c === "*") {
      regex += "[^/]*";
      i++;
    } else if (c === "?") {
      regex += ".";
      i++;
    } else if (c === "[") {
      const close = pattern.indexOf("]", i);
      if (close === -1) {
        regex += "\\[";
        i++;
      } else {
        regex += pattern.slice(i, close + 1);
        i = close + 1;
      }
    } else if ("\\^$.|+(){}".includes(c)) {
      regex += "\\" + c;
      i++;
    } else {
      regex += c;
      i++;
    }
  }
  return new RegExp(regex + "$");
}
