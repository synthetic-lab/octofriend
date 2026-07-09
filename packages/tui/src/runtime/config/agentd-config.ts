import { resolveAgentdCommand } from "../agent/command";
import { firstNonEmptyStdoutLine } from "../agent/stdout";

export type ConfigKeyResult =
	| { ok: true; key: string }
	| {
			ok: false;
			error:
				| { type: "missing"; message: string }
				| { type: "invalid"; message: string }
				| {
						type: "command_failed";
						message: string;
						exitCode?: number;
						stderr?: string;
				  };
	  };

export type ConfigSearchResult = { url: string; key: string } | null;

let nextRequestId = 1;

export async function configMigrate(config: unknown): Promise<unknown> {
	return (await agentdRequest("octofwen.agentd/configMigrate", { config }))[
		"config"
	];
}

export async function configSanitize(config: unknown): Promise<unknown> {
	return (await agentdRequest("octofwen.agentd/configSanitize", { config }))[
		"config"
	];
}

export async function configKeyForModel(
	model: unknown,
	config: unknown,
): Promise<ConfigKeyResult> {
	return (
		await agentdRequest("octofwen.agentd/configKeyForModel", { model, config })
	)["result"] as ConfigKeyResult;
}

export async function configKeyForBaseUrl(
	baseUrl: string,
	config: unknown,
): Promise<ConfigKeyResult> {
	return (
		await agentdRequest("octofwen.agentd/configKeyForBaseUrl", {
			baseUrl,
			config,
		})
	)["result"] as ConfigKeyResult;
}

export async function configSearch(
	config: unknown,
): Promise<ConfigSearchResult> {
	return (await agentdRequest("octofwen.agentd/configSearch", { config }))[
		"search"
	] as ConfigSearchResult;
}

export async function configHasExistingKey(
	baseUrl: string,
	config: unknown,
): Promise<boolean> {
	return Boolean(
		(
			await agentdRequest("octofwen.agentd/configHasExistingKey", {
				baseUrl,
				config,
			})
		)["hasExistingKey"],
	);
}
export async function configRunNotify(config: unknown): Promise<void> {
	await agentdRequest("octofwen.agentd/configRunNotify", { config });
}

export async function configDefaultPaths(): Promise<{
	configDir: string;
	configFile: string;
	keyFile: string;
}> {
	const result = await agentdRequest("octofwen.agentd/configDefaultPaths", {});
	if (
		typeof result["configDir"] !== "string" ||
		typeof result["configFile"] !== "string" ||
		typeof result["keyFile"] !== "string"
	) {
		return Promise.reject(
			new Error("Invalid octofwen-agentd config paths result"),
		);
	}
	return {
		configDir: result["configDir"],
		configFile: result["configFile"],
		keyFile: result["keyFile"],
	};
}

export async function configMergeEnvVar(
	config: unknown,
	model: unknown,
	apiEnvVar: string,
): Promise<unknown> {
	return (
		await agentdRequest("octofwen.agentd/configMergeEnvVar", {
			config,
			model,
			apiEnvVar,
		})
	)["config"];
}

export async function configMergeAutofixEnvVar(
	config: unknown,
	key: "diffApply" | "fixJson",
	model: unknown,
	apiEnvVar: string,
): Promise<unknown> {
	return (
		await agentdRequest("octofwen.agentd/configMergeAutofixEnvVar", {
			config,
			key,
			model,
			apiEnvVar,
		})
	)["config"];
}

export async function modelProviderCatalog(): Promise<Record<string, unknown>> {
	return await agentdRequest("octofwen.agentd/modelProviderCatalog", {});
}

export async function configWriteKey(
	baseUrl: string,
	apiKey: string,
): Promise<void> {
	await agentdRequest("octofwen.agentd/configWriteKey", { baseUrl, apiKey });
}

async function agentdRequest(
	method: string,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const subprocess = Bun.spawn(resolveAgentdCommand(), {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		env: process.env,
	});
	const id = nextRequestId++;
	subprocess.stdin.write(
		`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
	);
	subprocess.stdin.flush();
	subprocess.stdin.end();
	const [stdout, stderr] = await Promise.all([
		new Response(subprocess.stdout).text(),
		new Response(subprocess.stderr).text(),
	]);
	const exitCode = await subprocess.exited;
	if (exitCode !== 0) {
		return Promise.reject(
			new Error(`octofwen-agentd exited with code ${exitCode}: ${stderr}`),
		);
	}
	const firstLine = firstNonEmptyStdoutLine(stdout);
	if (!firstLine) {
		return Promise.reject(new Error("octofwen-agentd returned no response"));
	}
	const response = JSON.parse(firstLine) as {
		id?: unknown;
		result?: unknown;
		error?: { message?: string };
	};
	if (response.error) {
		return Promise.reject(
			new Error(response.error.message ?? "octofwen-agentd request failed"),
		);
	}
	if (!isRecord(response.result)) {
		return Promise.reject(
			new Error("octofwen-agentd returned invalid config response"),
		);
	}
	return response.result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
