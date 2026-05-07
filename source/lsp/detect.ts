import path from "path";
import { existsSync } from "fs";
import which from "which";
import { RecommendedLspServers } from "./lsp-server-registry.ts";
import { InstalledLspConfig, LspClient, getOrStartLspClient } from "./client.ts";
import { Config } from "../config.ts";

let cachedCustomLspConfig: Record<string, InstalledLspConfig> | null = null;

let usableLspsPerExtension: Record<string, InstalledLspConfig> | null = null;

export async function isCommandExecutable(command: string): Promise<boolean> {
  const result = await which(command, { nothrow: true });
  return result !== null;
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
  cwd: string,
  config: Config,
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
    if (await isLspUsableInProject(server, config)) {
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
  cwd: string,
  config: Config,
  extension: string,
): Promise<InstalledLspConfig | null> {
  const usableLsps = await ensureUsableLspsPopulated(cwd, config);
  return usableLsps[extension] ?? null;
}

/**
 * @returns    set of file extensions that have an installed non-disabled LSP server
 */
export async function getUsableLspExtensions(cwd: string, config: Config): Promise<Set<string>> {
  const usableLsps = await ensureUsableLspsPopulated(cwd, config);
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

export function findNearestRoot(
  rootCandidates: string[],
  filePath: string,
  cwd: string,
): string | null {
  // an empty rootCandidates list is okay, some LSPs don't need it
  if (rootCandidates.length === 0) return cwd;

  let currDirectory = path.dirname(filePath);
  const boundary = path.resolve(cwd);

  while (currDirectory.startsWith(boundary)) {
    const matchingCandidate = rootCandidates.find(candidate =>
      existsSync(path.join(currDirectory, candidate)),
    );
    if (matchingCandidate) {
      return currDirectory;
    }
    const parent = path.dirname(currDirectory);
    if (parent === currDirectory) break;
    currDirectory = parent;
  }
  return null;
}

export async function detectLspServerForFile(
  cwd: string,
  filePath: string,
  config: Config,
): Promise<LspServerResult> {
  if (isLspGloballyDisabled(config)) {
    return { status: "all-disabled" };
  }
  const extension = path.extname(filePath).toLowerCase();
  if (!extension) {
    return { status: "no-server" };
  }

  const installedLsp = await getUsableLspForExtension(cwd, config, extension);

  if (installedLsp) {
    const rootPath = findNearestRoot(installedLsp.rootCandidates, filePath, cwd);
    if (!rootPath) return { status: "no-server" };
    return { status: "found", lspConfig: installedLsp, rootPath };
  }
  return { status: "no-server" };
}

async function isLspUsableInProject(server: InstalledLspConfig, config: Config): Promise<Boolean> {
  if (isLspGloballyDisabled(config)) {
    return false;
  }

  const executable = server.command[0];
  const isLspDisabled = isLspDisabledByUser(server.serverName, config);
  return !isLspDisabled && (await isCommandExecutable(executable));
}

export async function getLspClientForFile(
  cwd: string,
  config: Config,
  filePath: string,
): Promise<LspClient | null> {
  const lspServerResult = await detectLspServerForFile(cwd, filePath, config);
  if (lspServerResult.status === "found") {
    const { lspConfig, rootPath } = lspServerResult;
    return getOrStartLspClient(lspConfig, rootPath);
  }
  return null;
}
