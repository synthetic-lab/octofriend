import fs from "node:fs/promises";
import path from "node:path";
import json5 from "json5";
import {
	AgentdRustBridge,
	spawnAgentdProcessClient,
} from "../bridge/agent/agent.ts";
import type { Config } from "./schemas.ts";

type ConfigFileOptions = {
	bridge?: AgentdRustBridge;
};

export async function writeConfig(
	c: Config,
	configPath: string,
	options: ConfigFileOptions = {},
) {
	const dir = path.dirname(configPath);
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(
		configPath,
		json5.stringify(await sanitizeConfig(c, options), null, 2),
	);
}

export async function readConfig(
	filePath: string,
	options: ConfigFileOptions = {},
): Promise<Config> {
	const file = await fs.readFile(filePath, "utf8");
	const parsed = json5.parse(file.trim());
	const fileVersion: number = parsed["configVersion"] ?? 0;
	const raw = await migrateConfig(parsed, options);
	const config = raw as Config;
	const currentVersion = config.configVersion ?? fileVersion;
	if (fileVersion < currentVersion) {
		await writeConfig(config, filePath, options);
	}
	return config;
}

async function withConfigBridge<T>(
	options: ConfigFileOptions,
	callback: (bridge: AgentdRustBridge) => Promise<T>,
): Promise<T> {
	if (options.bridge) return await callback(options.bridge);
	const bridge = new AgentdRustBridge(spawnAgentdProcessClient());
	try {
		return await callback(bridge);
	} finally {
		bridge.close();
	}
}

async function migrateConfig(
	config: unknown,
	options: ConfigFileOptions,
): Promise<unknown> {
	return await withConfigBridge(
		options,
		async (bridge) => (await bridge.configMigrate({ config })).config,
	);
}

async function sanitizeConfig(
	config: Config,
	options: ConfigFileOptions,
): Promise<Record<string, unknown>> {
	return await withConfigBridge(options, async (bridge) => {
		const sanitized = (await bridge.configSanitize({ config })).config;
		if (
			typeof sanitized !== "object" ||
			sanitized === null ||
			Array.isArray(sanitized)
		) {
			return Promise.reject(
				new Error("Invalid octofriend-agentd config sanitize result"),
			);
		}
		return sanitized as Record<string, unknown>;
	});
}
