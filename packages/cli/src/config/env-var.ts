import { spawnAgentdProcess } from "../bridge/platform/platform";
import { AgentdProcessClient } from "../bridge/ipc/client";
import type { Config } from "./schemas";

export async function mergeEnvVar(
	config: Config,
	model: Config["models"][number],
	apiEnvVar: string,
): Promise<Config> {
	return (await requestConfigMerge("octofwen.agentd/configMergeEnvVar", {
		config,
		model,
		apiEnvVar,
	})) as Config;
}

export async function mergeAutofixEnvVar<K extends "diffApply" | "fixJson">(
	config: Config,
	key: K,
	model: Exclude<Config[K], undefined>,
	apiEnvVar: string,
): Promise<Config> {
	return (await requestConfigMerge("octofwen.agentd/configMergeAutofixEnvVar", {
		config,
		key,
		model,
		apiEnvVar,
	})) as Config;
}

async function requestConfigMerge(
	method: string,
	params: Record<string, unknown>,
): Promise<unknown> {
	const client = new AgentdProcessClient(spawnAgentdProcess());
	try {
		const result = await client.request(method, params);
		if (!(isRecord(result) && "config" in result)) {
			return Promise.reject(
				new Error("Invalid octofwen-agentd config merge result"),
			);
		}
		return result["config"];
	} finally {
		client.close();
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
