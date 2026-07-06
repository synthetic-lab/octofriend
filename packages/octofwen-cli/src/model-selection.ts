import { resolveAgentdCommand } from "./bridge/node/platform.ts";
import type { Config } from "./configuration/schemas.ts";

type ModelName = {
	nickname: string;
};

export function formatAvailableModels(models: readonly ModelName[]): string {
	return `- ${models.map((model) => model.nickname).join("\n- ")}`;
}

export function selectModel(
	config: Config,
	modelNickname?: string,
): Config["models"][number] | undefined {
	return configSelectModel(config, modelNickname ?? null);
}

export function exitForMissingModel(
	models: readonly ModelName[],
	modelNickname?: string,
): never {
	console.error(
		`No model with the nickname ${modelNickname} found. Did you add it to Octo?`,
	);
	console.error("The available models are:");
	console.error(formatAvailableModels(models));
	process.exit(1);
}

function configSelectModel(
	config: Config,
	modelOverride: string | null,
): Config["models"][number] | undefined {
	const result = agentdRequestSync("octofwen.agentd/configSelectModel", {
		config,
		modelOverride,
	});
	return isRecord(result)
		? (result["model"] as Config["models"][number])
		: undefined;
}

function agentdRequestSync(
	method: string,
	params: Record<string, unknown>,
): unknown {
	const id = 1;
	const stdin = new TextEncoder().encode(
		`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
	);
	const subprocess = Bun.spawnSync(resolveAgentdCommand(), {
		stdin,
		stdout: "pipe",
		stderr: "pipe",
		env: process.env,
	});
	if (subprocess.exitCode !== 0) {
		throw new Error(
			`octofwen-agentd exited with code ${subprocess.exitCode}: ${subprocess.stderr.toString()}`,
		);
	}
	const line = subprocess.stdout
		.toString()
		.split("\n")
		.find((entry) => entry.trim() !== "");
	if (!line) throw new Error("octofwen-agentd returned no response");
	const response = JSON.parse(line) as {
		result?: unknown;
		error?: { message?: string };
	};
	if (response.error) {
		throw new Error(response.error.message ?? "octofwen-agentd request failed");
	}
	return response.result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
