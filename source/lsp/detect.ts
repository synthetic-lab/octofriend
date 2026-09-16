import path from "path";
import { quote } from "shell-quote";
import type { Transport } from "../transports/transport-common.ts";
import { RecommendedLspServers } from "./lsp-server-registry.ts";
import { InstalledLspConfig, LspClient, getOrStartLspClient } from "./client.ts";
import { Config } from "../config.ts";

let cachedCustomLspConfig: Record<string, InstalledLspConfig> | null = null;

let usableLspsPerExtension: Record<string, InstalledLspConfig> | null = null;

export async function isCommandExecutable(
  signal: AbortSignal,
  command: string,
  transport: Transport,
): Promise<boolean> {
  try {
    await transport.shell(signal, `test -x "$(command -v ${quote([command])})"`, 5000);
    return true;
  } catch {
    return false;
  }
}

export function isLspGloballyDisabled(config: Config): boolean {
  return config.lsp === false;
}

export function isLspDisabledByUser(serverName: string, config: Config): boolean {
  if (isLspGloballyDisabled(config)) return true;
  if (!config.lsp) return false;
  const entry = config.lsp[serverName];
  return entry != null && "disabled" in entry;
}

async function ensureUsableLspsPopulated(
  signal: AbortSignal,
  cwd: string,
  config: Config,
  transport: Transport,
): Promise<Record<string, InstalledLspConfig>> {
  if (usableLspsPerExtension != null) return usableLspsPerExtension;

  const tempUsableLspsPerExtension: Record<string, InstalledLspConfig> = {};
  if (cachedCustomLspConfig == null) {
    cachedCustomLspConfig = await loadCustomLspConfig(config);
  }

  const customServers = Object.values(cachedCustomLspConfig);
  const recommendedServers = RecommendedLspServers.map(
    (recommendedLsp): InstalledLspConfig => ({
      serverName: recommendedLsp.serverName,
      command: recommendedLsp.command,
      extensions: recommendedLsp.extensions,
      rootCandidates: recommendedLsp.rootCandidates ?? [],
    }),
  );
  // Custom configured servers override Octo's recommended servers
  const lspServers = [...recommendedServers, ...customServers];
  for (const server of lspServers) {
    if (await isLspUsableInProject(signal, server, config, transport)) {
      server.extensions.forEach(extension => {
        tempUsableLspsPerExtension[extension] = server;
      });
    }
  }
  usableLspsPerExtension = tempUsableLspsPerExtension;
  return usableLspsPerExtension;
}

/**
 * Searches configured custom LSP servers and recommended LSP Servers for the corresponding extension.
 *
 * @returns    first installed & non-disabled LSP server
 */
export async function getUsableLspForExtension(
  signal: AbortSignal,
  cwd: string,
  config: Config,
  extension: string,
  transport: Transport,
): Promise<InstalledLspConfig | null> {
  const usableLsps = await ensureUsableLspsPopulated(signal, cwd, config, transport);
  return usableLsps[extension] ?? null;
}

/**
 * @returns    set of file extensions that have an installed non-disabled LSP server
 */
export async function getUsableLspExtensions(
  signal: AbortSignal,
  cwd: string,
  config: Config,
  transport: Transport,
): Promise<Set<string>> {
  const usableLsps = await ensureUsableLspsPopulated(signal, cwd, config, transport);
  return new Set(Object.keys(usableLsps));
}

export async function loadCustomLspConfig(
  appConfig: Config,
): Promise<Record<string, InstalledLspConfig>> {
  cachedCustomLspConfig = {};
  if (isLspGloballyDisabled(appConfig) || !appConfig.lsp) return {};
  for (const [name, entry] of Object.entries(appConfig.lsp)) {
    if ("disabled" in entry) continue;
    cachedCustomLspConfig[name] = {
      serverName: name,
      command: entry.command,
      extensions: entry.extensions,
      rootCandidates: entry.rootCandidates,
    };
  }
  return cachedCustomLspConfig;
}

export type LspServerResult =
  | { status: "found"; lspConfig: InstalledLspConfig; rootPath: string }
  | { status: "all-disabled" }
  | { status: "no-server" };

export async function detectLspServerForFile(
  signal: AbortSignal,
  cwd: string,
  filePath: string,
  config: Config,
  transport: Transport,
): Promise<LspServerResult> {
  if (isLspGloballyDisabled(config)) {
    return { status: "all-disabled" };
  }
  const extension = path.extname(filePath).toLowerCase();
  if (!extension) {
    return { status: "no-server" };
  }

  const installedLsp = await getUsableLspForExtension(signal, cwd, config, extension, transport);

  if (installedLsp) {
    const rootPath = await findNearestRoot(
      signal,
      installedLsp.rootCandidates,
      filePath,
      cwd,
      transport,
    );
    if (!rootPath) return { status: "no-server" };
    return { status: "found", lspConfig: installedLsp, rootPath };
  }
  return { status: "no-server" };
}

async function findNearestRoot(
  signal: AbortSignal,
  rootCandidates: string[],
  filePath: string,
  cwd: string,
  transport: Transport,
): Promise<string | null> {
  if (rootCandidates.length === 0) return cwd;
  let currDirectory = path.dirname(filePath);
  const boundary = path.resolve(cwd);
  while (currDirectory.startsWith(boundary)) {
    for (const candidate of rootCandidates) {
      if (await transport.pathExists(signal, path.join(currDirectory, candidate))) {
        return currDirectory;
      }
    }
    const parent = path.dirname(currDirectory);
    if (parent === currDirectory) break;
    currDirectory = parent;
  }
  return null;
}

async function isLspUsableInProject(
  signal: AbortSignal,
  server: InstalledLspConfig,
  config: Config,
  transport: Transport,
): Promise<boolean> {
  if (isLspGloballyDisabled(config)) {
    return false;
  }

  const executable = server.command[0];
  const isLspDisabled = isLspDisabledByUser(server.serverName, config);
  return !isLspDisabled && (await isCommandExecutable(signal, executable, transport));
}

export async function getLspClientForFile(
  signal: AbortSignal,
  cwd: string,
  config: Config,
  filePath: string,
  transport: Transport,
): Promise<LspClient | null> {
  const lspServerResult = await detectLspServerForFile(signal, cwd, filePath, config, transport);
  if (lspServerResult.status === "found") {
    const { lspConfig, rootPath } = lspServerResult;
    return getOrStartLspClient(lspConfig, rootPath, transport);
  }
  return null;
}
