import path from "path";
import { quote } from "shell-quote";
import type { Transport } from "../libocto/transport.ts";
import { ok, type Result } from "../libocto/result.ts";
import { RecommendedLspServers } from "./lsp-server-registry.ts";
import { InstalledLspConfig, LspClient, getOrStartLspClient } from "./client.ts";
import type { LspToolData } from "../tools/tool-data.ts";

let cachedCustomLspConfig: Record<string, InstalledLspConfig> | null = null;

let usableLspsPerExtension: Record<string, InstalledLspConfig> | null = null;

export async function isCommandExecutable(
  signal: AbortSignal,
  command: string,
  transport: Transport,
): Promise<boolean> {
  const result = await transport.shell(signal, `test -x "$(command -v ${quote([command])})"`, 5000);
  return result.success;
}

export function isLspGloballyDisabled(data: LspToolData): boolean {
  return data.lsp.disabled === true;
}

export function isLspDisabledByUser(serverName: string, data: LspToolData): boolean {
  if (isLspGloballyDisabled(data)) return true;
  const entry = data.lsp.config[serverName];
  return entry != null && "disabled" in entry;
}

async function ensureUsableLspsPopulated(
  signal: AbortSignal,
  cwd: string,
  data: LspToolData,
  transport: Transport,
): Promise<Record<string, InstalledLspConfig>> {
  if (usableLspsPerExtension != null) return usableLspsPerExtension;

  const tempUsableLspsPerExtension: Record<string, InstalledLspConfig> = {};
  if (cachedCustomLspConfig == null) {
    cachedCustomLspConfig = await loadCustomLspConfig(data);
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
    if (await isLspUsableInProject(signal, server, data, transport)) {
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
  data: LspToolData,
  extension: string,
  transport: Transport,
): Promise<InstalledLspConfig | null> {
  const usableLsps = await ensureUsableLspsPopulated(signal, cwd, data, transport);
  return usableLsps[extension] ?? null;
}

/**
 * @returns    set of file extensions that have an installed non-disabled LSP server
 */
export async function getUsableLspExtensions(
  signal: AbortSignal,
  cwd: string,
  data: LspToolData,
  transport: Transport,
): Promise<Set<string>> {
  const usableLsps = await ensureUsableLspsPopulated(signal, cwd, data, transport);
  return new Set(Object.keys(usableLsps));
}

export async function loadCustomLspConfig(
  data: LspToolData,
): Promise<Record<string, InstalledLspConfig>> {
  cachedCustomLspConfig = {};
  if (isLspGloballyDisabled(data)) return {};
  for (const [name, entry] of Object.entries(data.lsp.config)) {
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
  data: LspToolData,
  transport: Transport,
): Promise<Result<LspServerResult, string>> {
  if (isLspGloballyDisabled(data)) {
    return ok({ status: "all-disabled" });
  }
  const extension = path.extname(filePath).toLowerCase();
  if (!extension) {
    return ok({ status: "no-server" });
  }

  const installedLsp = await getUsableLspForExtension(signal, cwd, data, extension, transport);

  if (installedLsp) {
    const rootPath = await findNearestRoot(
      signal,
      installedLsp.rootCandidates,
      filePath,
      cwd,
      transport,
    );
    if (!rootPath.success) return rootPath;
    if (!rootPath.data) return ok({ status: "no-server" });
    return ok({ status: "found", lspConfig: installedLsp, rootPath: rootPath.data });
  }
  return ok({ status: "no-server" });
}

async function findNearestRoot(
  signal: AbortSignal,
  rootCandidates: string[],
  filePath: string,
  cwd: string,
  transport: Transport,
): Promise<Result<string | null, string>> {
  if (rootCandidates.length === 0) return ok(cwd);
  let currDirectory = path.dirname(filePath);
  const boundary = await transport.resolvePath(signal, cwd);
  if (!boundary.success) return boundary;
  while (currDirectory.startsWith(boundary.data)) {
    for (const candidate of rootCandidates) {
      const exists = await transport.pathExists(signal, path.join(currDirectory, candidate));
      if (!exists.success) return exists;
      if (exists.data) return ok(currDirectory);
    }
    const parent = path.dirname(currDirectory);
    if (parent === currDirectory) break;
    currDirectory = parent;
  }
  return ok(null);
}

async function isLspUsableInProject(
  signal: AbortSignal,
  server: InstalledLspConfig,
  data: LspToolData,
  transport: Transport,
): Promise<boolean> {
  if (isLspGloballyDisabled(data)) {
    return false;
  }

  const executable = server.command[0];
  const isLspDisabled = isLspDisabledByUser(server.serverName, data);
  return !isLspDisabled && (await isCommandExecutable(signal, executable, transport));
}

export async function getLspClientForFile(
  signal: AbortSignal,
  cwd: string,
  data: LspToolData,
  filePath: string,
  transport: Transport,
): Promise<Result<LspClient | null, string>> {
  const lspServerResult = await detectLspServerForFile(signal, cwd, filePath, data, transport);
  if (!lspServerResult.success) return lspServerResult;
  if (lspServerResult.data.status === "found") {
    const { lspConfig, rootPath } = lspServerResult.data;
    return getOrStartLspClient(lspConfig, rootPath, transport);
  }
  return ok(null);
}
