import path from "path";
import { existsSync } from "fs";
import fs from "fs/promises";
import json5 from "json5";
import {
  RecommendedLspServers,
  type LspInstallationConfig as LspInstallationConfig,
} from "./lsp-server-registry.ts";
import { InstalledLspConfig, LspClient, getOrStartLspClient } from "./client.ts";
import { Config, LspServerConfigSchema } from "../config.ts";
import { t } from "structural";
import { execFile } from "child_process";

export type LspConfigsPerExtension = Record<string, InstalledLspConfig>;

// contents of lsp.json5
const cachedProjectLspConfig: LspConfigsPerExtension = {};
// indexed by file extension
const cachedLspRecommendation: Map<string, LspInstallationConfig> = new Map();
// indexed by file extension
const cachedInstalledLsp: Map<string, InstalledLspConfig> = new Map();

export function hasCachedInstalledLsp(extension: string): boolean {
  return cachedInstalledLsp.has(extension);
}

function commandExists(binary: string): Promise<boolean> {
  return new Promise(resolve => {
    execFile("which", [binary], err => {
      resolve(!err);
    });
  });
}

export async function isCommandExecutable(command: string): Promise<boolean> {
  if (!command) return false;
  try {
    return await commandExists(command);
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
  return config.lsp[serverName]?.disabled === true;
}

/**
 * Searches lsp.json5 and recommended LSP Servers for the corresponding extension.
 * Returns either installedLsp or lspRecommendation, prioritizing installedLsp.
 * Caches results in cachedInstalledLsp and cachedLspRecommendation.
 *
 * @returns {InstalledLspConfig} installedLsp: installed LSP compatible with the file extension,
 * either installed this session or read from lsp.json5 at startup.
 * @returns {LspInstallationConfig} lspRecommendation: servers that are recommended based on
 * the file extension, but not yet installed.
 */
export async function findAndCacheServersForExtension(
  cwd: string,
  appConfig: Config,
  extension: string,
): Promise<{
  installedLsp?: InstalledLspConfig; // first server found that has been installed and NOT disabled by user
  lspRecommendation?: LspInstallationConfig; // first server found in lsp-server-registry that is not installed and NOT disabled by user
}> {
  if (isLspGloballyDisabled(appConfig)) {
    return {};
  }
  // First check the caches for this extension
  const installedLspConfig = cachedInstalledLsp.get(extension);
  if (installedLspConfig) {
    if (await isCommandExecutable(installedLspConfig.command[0])) {
      return { installedLsp: installedLspConfig };
    } else {
      // If the command is no longer executable, remove from cache and continue searching
      cachedInstalledLsp.delete(extension);
    }
  }

  const lspRecommendationForExtension = cachedLspRecommendation.get(extension);
  if (lspRecommendationForExtension) {
    if (await isCommandExecutable(lspRecommendationForExtension.command[0])) {
      const installedLspConfig: InstalledLspConfig = {
        serverName: lspRecommendationForExtension.serverName,
        command: lspRecommendationForExtension.command,
        extensions: lspRecommendationForExtension.extensions,
        rootCandidates: lspRecommendationForExtension.rootCandidates ?? [],
      };
      cachedInstalledLsp.set(extension, installedLspConfig);
      cachedLspRecommendation.delete(extension);
      await writeProjectLspConfig(cwd);
      return { installedLsp: installedLspConfig };
    }
    return { lspRecommendation: lspRecommendationForExtension };
  }

  const projectServers = Object.values(cachedProjectLspConfig).filter(lspConfig =>
    lspConfig.extensions.includes(extension),
  );
  for (const server of projectServers) {
    const executable = server.command[0];
    if (await isCommandExecutable(executable)) {
      // add this server to all extensions it supports in the cache
      server.extensions.forEach(extension => {
        cachedInstalledLsp.set(extension, server);
      });
      await writeProjectLspConfig(cwd);
      return { installedLsp: server };
    }
  }

  const recommendedServers = RecommendedLspServers.filter(server =>
    server.extensions.includes(extension),
  );
  for (const server of recommendedServers) {
    if (!isLspDisabledByUser(server.serverName, appConfig)) {
      const executable = server.command[0];
      if (await isCommandExecutable(executable)) {
        const installedLspConfig: InstalledLspConfig = {
          serverName: server.serverName,
          command: server.command,
          extensions: server.extensions,
          rootCandidates: server.rootCandidates ?? [],
        };
        server.extensions.forEach(extension => {
          cachedInstalledLsp.set(extension, installedLspConfig);
        });
        await writeProjectLspConfig(cwd);
        return { installedLsp: installedLspConfig };
      } else {
        server.extensions.forEach(extension => {
          cachedLspRecommendation.set(extension, server);
        });
        return { lspRecommendation: server };
      }
    }
  }

  return { installedLsp: undefined, lspRecommendation: undefined };
}

// Parses lsp.json5 and populates cachedProjectLspConfig with non-disabled LSPs
export async function loadProjectLspConfig(cwd: string, appConfig: Config): Promise<void> {
  if (isLspGloballyDisabled(appConfig)) {
    return;
  }
  const configPath = getProjectLspConfigPath(cwd);
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed: Record<string, InstalledLspConfig> = ProjectLspConfigSchema.slice(
      json5.parse(raw),
    );
    for (const [name, config] of Object.entries(parsed)) {
      if (!isLspDisabledByUser(name, appConfig)) {
        cachedProjectLspConfig[name] = config;
      }
    }
  } catch {
    // TODO: warn user about malformed JSON5
  }
}

export type LspServerResult =
  | { status: "found"; lspConfig: InstalledLspConfig; rootPath: string }
  | { status: "recommending"; lspInstallationConfig: LspInstallationConfig; rootPath: string }
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
  appConfig: Config,
): Promise<LspServerResult> {
  if (isLspGloballyDisabled(appConfig)) {
    return { status: "all-disabled" };
  }
  const fileExtension = path.extname(filePath).toLowerCase();
  if (!fileExtension) {
    return { status: "no-server" };
  }

  const { installedLsp, lspRecommendation } = await findAndCacheServersForExtension(
    cwd,
    appConfig,
    fileExtension,
  );

  if (installedLsp) {
    const rootPath = findNearestRoot(installedLsp.rootCandidates, filePath, cwd);
    if (!rootPath) return { status: "no-server" };
    return { status: "found", lspConfig: installedLsp, rootPath };
  } else if (lspRecommendation) {
    const rootPath = findNearestRoot(lspRecommendation.rootCandidates, filePath, cwd);
    if (!rootPath) return { status: "no-server" };
    return { status: "recommending", lspInstallationConfig: lspRecommendation, rootPath };
  }
  return { status: "no-server" };
}

const ProjectLspConfigSchema = t.dict(LspServerConfigSchema);

function getProjectLspConfigPath(cwd: string): string {
  return path.join(cwd, ".octofriend", "lsp.json5");
}

export async function writeProjectLspConfig(cwd: string): Promise<void> {
  const configPath = getProjectLspConfigPath(cwd);
  const dir = path.dirname(configPath);
  await fs.mkdir(dir, { recursive: true });

  const record: Record<string, InstalledLspConfig> = {};
  for (const config of cachedInstalledLsp.values()) {
    record[config.serverName] = config;
  }

  await fs.writeFile(configPath, json5.stringify(record, null, 2));
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
