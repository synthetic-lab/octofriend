import { spawnAgentdProcess } from "../bridge/platform/platform";
import { AgentdProcessClient } from "../bridge/ipc/client";

const paths = await configDefaultPaths();

export const PACKAGE_DIR = import.meta.dirname;
export const CONFIG_DIR = paths.configDir;
export const KEY_FILE = paths.keyFile;
export const CONFIG_FILE = paths.configFile;

async function configDefaultPaths(): Promise<{
	configDir: string;
	configFile: string;
	keyFile: string;
}> {
	const client = new AgentdProcessClient(spawnAgentdProcess());
	try {
		const result = await client.request("octofwen.agentd/configDefaultPaths");
		if (!isDefaultPathsResult(result)) {
			return Promise.reject(
				new Error("Invalid octofwen-agentd config paths result"),
			);
		}
		return result;
	} finally {
		client.close();
	}
}

function isDefaultPathsResult(value: unknown): value is {
	configDir: string;
	configFile: string;
	keyFile: string;
} {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { configDir?: unknown }).configDir === "string" &&
		typeof (value as { configFile?: unknown }).configFile === "string" &&
		typeof (value as { keyFile?: unknown }).keyFile === "string"
	);
}
