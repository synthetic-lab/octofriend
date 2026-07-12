import { render } from "ink";
import {
	type AgentdRustBridge,
	createAgentdRustBridge,
} from "./bridge/agent/agent.ts";
import { readConfig, writeConfig } from "./config/config-file.ts";
import { fileExists } from "./config/filesystem.ts";
import { readKeyForModel } from "./config/keys.ts";
import { CONFIG_DIR, CONFIG_FILE } from "./config/paths.ts";
import type { Config } from "./config/schemas.ts";
import { loadTui } from "./launch-tui.ts";
import { selectModel } from "./model-selection.ts";
import { err, ok, type Result } from "./result.ts";
import { markUpdatesSeen, type UpdateNotificationsMarker } from "./updates.ts";

export const CONFIG_STANDARD_DIR = CONFIG_DIR;
export const CONFIG_JSON5_FILE = CONFIG_FILE;

async function configAutofixKeys(
	bridge: AgentdRustBridge,
): Promise<Result<Array<"diffApply" | "fixJson">, string>> {
	try {
		return ok((await bridge.configAutofixKeys()).keys);
	} catch (error) {
		if (
			error instanceof Error &&
			error.message === "Invalid octofriend-agentd autofix keys result"
		) {
			return err(error.message);
		}
		throw error;
	}
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
	const ownedBridge = options.bridge ? null : await createAgentdRustBridge();
	const bridge = options.bridge ?? ownedBridge;
	if (bridge == null) {
		console.error("Missing octofriend-agentd bridge");
		process.exit(1);
	}
	try {
		const autofixKeys = await configAutofixKeys(bridge);
		if (!autofixKeys.success) {
			console.error(autofixKeys.error);
			process.exit(1);
		}
		for (const key of autofixKeys.data) {
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
	} finally {
		ownedBridge?.close();
	}
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

	const inheritedOAuthModel = loaded.config.models.find(
		(model) =>
			model.model === autofixModel.model &&
			model.auth?.type === "env" &&
			model.auth.credential === "chatgpt-oauth",
	);
	if (inheritedOAuthModel?.auth) {
		const updatedConfig = {
			...loaded.config,
			[key]: { ...autofixModel, auth: inheritedOAuthModel.auth },
		};
		await writeConfig(updatedConfig, loaded.configPath, {
			bridge: options.bridge,
		});
		return { ...loaded, config: updatedConfig };
	}

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
	if (configPath) {
		return {
			configPath,
			config: await readConfig(configPath, { bridge: options.bridge }),
		};
	}

	if (await fileExists(CONFIG_JSON5_FILE)) {
		return {
			configPath: CONFIG_JSON5_FILE,
			config: await readConfig(CONFIG_JSON5_FILE, { bridge: options.bridge }),
		};
	}

	const markResult = await markUpdatesSeen({ mark: options.markUpdatesSeen });
	if (!markResult.success) {
		console.error(markResult.error);
	}
	const ownedBridge = options.bridge ? null : await createAgentdRustBridge();
	const bridge = options.bridge ?? ownedBridge;
	if (bridge == null) {
		console.error("Missing octofriend-agentd bridge");
		process.exit(1);
	}
	try {
		const { FirstTimeSetup } = await loadTui();
		const { waitUntilExit } = render(
			<FirstTimeSetup
				configPath={CONFIG_JSON5_FILE}
				modelConnectionTest={(params) => bridge.modelConnectionTest(params)}
				modelDiscover={(params) => bridge.modelDiscover(params)}
			/>,
		);
		await waitUntilExit();
		if (await fileExists(CONFIG_JSON5_FILE)) {
			return {
				configPath: CONFIG_JSON5_FILE,
				config: await readConfig(CONFIG_JSON5_FILE, { bridge }),
			};
		}
	} finally {
		ownedBridge?.close();
	}

	process.exit(1);
}
