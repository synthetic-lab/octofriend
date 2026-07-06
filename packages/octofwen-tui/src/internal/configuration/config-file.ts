import fs from "node:fs/promises";
import path from "node:path";
import json5 from "json5";
import { configMigrate, configSanitize } from "./agentd-config.ts";
import type { Config } from "./schemas.ts";

export async function writeConfig(c: Config, configPath: string) {
	const dir = path.dirname(configPath);
	await fs.mkdir(dir, { recursive: true });
	const sanitized = await sanitizedConfig(c);
	await fs.writeFile(configPath, json5.stringify(sanitized, null, 2));
}

export async function readConfig(filePath: string): Promise<Config> {
	const file = await fs.readFile(filePath, "utf8");
	const parsed = json5.parse(file.trim());
	const fileVersion: number = parsed["configVersion"] ?? 0;
	const raw = await configMigrate(parsed);
	const config = raw as Config;
	const currentVersion = config.configVersion ?? fileVersion;
	if (fileVersion < currentVersion) {
		await writeConfig(config, filePath);
	}
	return config;
}

async function sanitizedConfig(
	config: Config,
): Promise<Record<string, unknown>> {
	const sanitized = await configSanitize(config);
	if (
		typeof sanitized !== "object" ||
		sanitized === null ||
		Array.isArray(sanitized)
	) {
		throw new Error("Invalid octofwen-agentd config sanitize result");
	}
	return sanitized as Record<string, unknown>;
}
