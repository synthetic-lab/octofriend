import fs from "node:fs/promises";
import path from "node:path";
import json5 from "json5";
import {
	AgentdRustBridge,
	spawnAgentdProcessClient,
} from "../bridge/rust/agent.ts";
import type { Config } from "./schemas.ts";

export async function writeConfig(c: Config, configPath: string) {
	const dir = path.dirname(configPath);
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(
		configPath,
		json5.stringify(await sanitizeConfig(c), null, 2),
	);
}

export async function readConfig(filePath: string): Promise<Config> {
	const file = await fs.readFile(filePath, "utf8");
	const parsed = json5.parse(file.trim());
	const fileVersion: number = parsed["configVersion"] ?? 0;
	const raw = await migrateConfig(parsed);
	const config = raw as Config;
	const currentVersion = config.configVersion ?? fileVersion;
	if (fileVersion < currentVersion) {
		await writeConfig(config, filePath);
	}
	return config;
}

async function migrateConfig(config: unknown): Promise<unknown> {
	const bridge = new AgentdRustBridge(spawnAgentdProcessClient());
	try {
		return (await bridge.configMigrate({ config })).config;
	} finally {
		bridge.close();
	}
}

async function sanitizeConfig(
	config: Config,
): Promise<Record<string, unknown>> {
	const bridge = new AgentdRustBridge(spawnAgentdProcessClient());
	try {
		const sanitized = (await bridge.configSanitize({ config })).config;
		if (
			typeof sanitized !== "object" ||
			sanitized === null ||
			Array.isArray(sanitized)
		) {
			throw new Error("Invalid octofwen-agentd config sanitize result");
		}
		return sanitized as Record<string, unknown>;
	} finally {
		bridge.close();
	}
}
