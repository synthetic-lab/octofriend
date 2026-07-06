import { render } from "ink";
import { spawnAgentdProcess } from "./bridge/node/platform.ts";
import { AgentdProcessClient } from "./bridge/process/client.ts";
import {
	type AgentdRustBridge,
	createAgentdRustBridge,
} from "./bridge/rust/agent.ts";
import { readConfig } from "./configuration/config-file.ts";
import { fileExists } from "./configuration/filesystem.ts";
import { readKeyForModel } from "./configuration/keys.ts";
import { CONFIG_DIR, CONFIG_FILE } from "./configuration/paths.ts";
import type { Config } from "./configuration/schemas.ts";
import { selectModel } from "./model-selection.ts";
import { loadTui } from "./tui.ts";
import {
	markUpdatesSeen,
	type UpdateNotificationsMarker,
} from "./update-notifications.ts";

export const CONFIG_STANDARD_DIR = CONFIG_DIR;
export const CONFIG_JSON5_FILE = CONFIG_FILE;

async function configAutofixKeys(): Promise<Array<"diffApply" | "fixJson">> {
	const client = new AgentdProcessClient(spawnAgentdProcess());
	try {
		const result = await client.request("octofwen.agentd/configAutofixKeys");
		if (!isAutofixKeysResult(result)) {
			throw new Error("Invalid octofwen-agentd autofix keys result");
		}
		return result.keys;
	} finally {
		client.close();
	}
}

function isAutofixKeysResult(
	value: unknown,
): value is { keys: Array<"diffApply" | "fixJson"> } {
	return (
		typeof value === "object" &&
		value !== null &&
		Array.isArray((value as { keys?: unknown }).keys) &&
		(value as { keys: unknown[] }).keys.every(
			(key) => key === "diffApply" || key === "fixJson",
		)
	);
}

export type LoadedConfig = {
	config: Config;
	configPath: string;
};

export type LoadConfigOptions = {
	markUpdatesSeen?: UpdateNotificationsMarker;
	bridge?: AgentdRustBridge;
};

export async function loadConfig(
	path?: string,
	options: LoadConfigOptions = {},
): Promise<LoadedConfig> {
	let loaded = await loadConfigWithoutReauth(path, options);
	loaded = await ensureDefaultModelAuth(loaded, path, options);
	loaded = await ensureAutofixModelAuth(loaded, path, options);
	return loaded;
}

async function ensureDefaultModelAuth(
	loaded: LoadedConfig,
	path: string | undefined,
	options: LoadConfigOptions,
): Promise<LoadedConfig> {
	let { config, configPath } = loaded;
	let defaultModel = selectModel(config);
	if (!defaultModel) process.exit(1);
	if (await readKeyForModel(defaultModel, config)) return loaded;

	const { PreflightModelAuth } = await loadTui();
	const { waitUntilExit } = render(
		<PreflightModelAuth
			error="It looks like we need to set up auth for your default model"
			model={defaultModel}
			config={config}
			configPath={configPath}
		/>,
	);
	await waitUntilExit();
	const reloaded = await loadConfigWithoutReauth(path, options);
	config = reloaded.config;
	configPath = reloaded.configPath;
	defaultModel = selectModel(config);
	if (!defaultModel) process.exit(1);
	if (!(await readKeyForModel(defaultModel, config))) process.exit(1);
	return { config, configPath };
}

async function ensureAutofixModelAuth(
	loaded: LoadedConfig,
	path: string | undefined,
	options: LoadConfigOptions,
): Promise<LoadedConfig> {
	let { config, configPath } = loaded;
	for (const key of await configAutofixKeys()) {
		const reloaded = await ensureOneAutofixModelAuth(
			{ config, configPath },
			key,
			path,
			options,
		);
		config = reloaded.config;
		configPath = reloaded.configPath;
	}
	return { config, configPath };
}

async function ensureOneAutofixModelAuth(
	loaded: LoadedConfig,
	key: "diffApply" | "fixJson",
	path: string | undefined,
	options: LoadConfigOptions,
): Promise<LoadedConfig> {
	const autofixModel = loaded.config[key];
	if (!autofixModel) return loaded;
	if (await readKeyForModel(autofixModel, loaded.config)) return loaded;

	const { PreflightAutofixAuth } = await loadTui();
	const { waitUntilExit } = render(
		<PreflightAutofixAuth
			autofixKey={key}
			model={autofixModel}
			config={loaded.config}
			configPath={loaded.configPath}
		/>,
	);
	await waitUntilExit();
	const reloaded = await loadConfigWithoutReauth(path, options);
	const reloadedModel = reloaded.config[key];
	if (
		reloadedModel &&
		!(await readKeyForModel(reloadedModel, reloaded.config))
	) {
		process.exit(1);
	}
	return reloaded;
}

export async function loadConfigWithoutReauth(
	configPath?: string,
	options: LoadConfigOptions = {},
): Promise<LoadedConfig> {
	if (configPath) return { configPath, config: await readConfig(configPath) };

	if (await fileExists(CONFIG_JSON5_FILE)) {
		return {
			configPath: CONFIG_JSON5_FILE,
			config: await readConfig(CONFIG_JSON5_FILE),
		};
	}

	await markUpdatesSeen({ mark: options.markUpdatesSeen });
	const ownedBridge = options.bridge ? null : await createAgentdRustBridge();
	const bridge = options.bridge ?? ownedBridge;
	if (!bridge) throw new Error("Missing octofwen-agentd bridge");
	try {
		const { FirstTimeSetup } = await loadTui();
		const { waitUntilExit } = render(
			<FirstTimeSetup
				configPath={CONFIG_JSON5_FILE}
				modelConnectionTest={(params) => bridge.modelConnectionTest(params)}
			/>,
		);
		await waitUntilExit();
	} finally {
		ownedBridge?.close();
	}

	if (await fileExists(CONFIG_JSON5_FILE)) {
		return {
			configPath: CONFIG_JSON5_FILE,
			config: await readConfig(CONFIG_JSON5_FILE),
		};
	}

	process.exit(1);
}
