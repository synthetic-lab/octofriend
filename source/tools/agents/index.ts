import path from "path";
import { fileURLToPath } from "url";
import { Transport, getEnvVar } from "../../transports/transport-common.ts";
import * as logger from "../../logger.ts";
import { Config } from "../../config.ts";
import { Agent, parseAgentContent, validateAgent } from "./agent-parser.ts";

const AGENT_FILE_NAME = "AGENT.md";

const __dir = path.dirname(fileURLToPath(import.meta.url));

async function* walkDirectory(
  transport: Transport,
  signal: AbortSignal,
  dirPath: string,
): AsyncGenerator<string> {
  let entries: Array<{ entry: string; isDirectory: boolean }>;
  try {
    entries = await transport.readdir(signal, dirPath);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (signal.aborted) return;

    const fullPath = path.join(dirPath, entry.entry);

    if (entry.isDirectory) {
      yield* walkDirectory(transport, signal, fullPath);
    } else if (entry.entry === AGENT_FILE_NAME) {
      yield fullPath;
    }
  }
}

async function getDefaultAgentsPaths(transport: Transport, signal: AbortSignal): Promise<string[]> {
  const paths: string[] = [];

  // Built-in agents directory
  // When running from source: source/tools/agents/ -> ../../../agents = project_root/agents
  // When running from dist: dist/source/tools/agents/ -> ../../../agents = dist/agents (wrong!)
  // We need to check if we're in dist and adjust accordingly
  const isCompiled = __dir.includes("/dist/") || __dir.includes("\\dist\\");
  const builtInPath = isCompiled
    ? path.resolve(__dir, "../../../../agents") // From dist/source/tools/agents -> project_root/agents
    : path.resolve(__dir, "../../../agents"); // From source/tools/agents -> project_root/agents
  paths.push(builtInPath);

  // User config path
  const home = await getEnvVar(signal, transport, "HOME", 5000);
  paths.push(path.join(home, ".config/agents/agents"));

  // Project-local path
  const pwd = await transport.cwd(signal);
  paths.push(path.join(pwd, ".agents", "agents"));

  return paths;
}

export async function discoverAgents(
  transport: Transport,
  signal: AbortSignal,
  config: Config,
): Promise<Agent[]> {
  const agentsPaths = [];
  const defaultPaths = await getDefaultAgentsPaths(transport, signal);
  agentsPaths.push(...defaultPaths);

  // Add custom paths from config if present
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agentsConfig = (config as any).agents;
  if (agentsConfig?.paths && agentsConfig.paths.length > 0) {
    agentsPaths.push(...agentsConfig.paths);
  }

  const agents: Agent[] = [];
  const seen = new Set<string>();
  const seenNames = new Set<string>();

  for (const basePath of agentsPaths) {
    if (signal.aborted) break;

    let exists: boolean;
    try {
      exists = await transport.pathExists(signal, basePath);
    } catch {
      // If aborted during pathExists, break out
      if (signal.aborted) break;
      // Otherwise skip this path
      continue;
    }
    if (!exists) continue;

    for await (const filePath of walkDirectory(transport, signal, basePath)) {
      if (signal.aborted) break;
      if (seen.has(filePath)) continue;
      seen.add(filePath);

      try {
        const content = await transport.readFile(signal, filePath);

        // Check if aborted during readFile
        if (signal.aborted) break;

        const agent = parseAgentContent(content, filePath);

        if (!agent) {
          logger.error("info", `Failed to parse agent file: ${filePath}`);
          continue;
        }

        const errors = validateAgent(agent);
        if (errors.length > 0) {
          logger.error("info", `Agent validation failed for ${filePath}: ${errors.join(", ")}`);
          continue;
        }

        if (seenNames.has(agent.name)) {
          logger.error("info", `Duplicate agent name "${agent.name}" at ${filePath}, skipping`);
          continue;
        }
        seenNames.add(agent.name);

        agents.push(agent);
      } catch (e) {
        logger.error("info", `Error reading agent file ${filePath}: ${e}`);
      }
    }
  }

  return agents;
}

export type { Agent } from "./agent-parser.ts";
export { parseAgentContent, validateAgent } from "./agent-parser.ts";
