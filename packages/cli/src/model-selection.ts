import { resolveAgentdCommand } from "./bridge/platform/platform.ts";
import type { Config } from "./config/schemas.ts";
import { err, ok, type Result } from "./result.ts";

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
	const result = agentdRequestSync("octofriend.agentd/configSelectModel", {
		config,
		modelOverride,
	});
	if (!result.success) return undefined;
	return isRecord(result.data)
		? (result.data["model"] as Config["models"][number])
		: undefined;
}

function agentdRequestSync(
	method: string,
	params: Record<string, unknown>,
): Result<unknown, string> {
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
		return err(
			`octofriend-agentd exited with code ${subprocess.exitCode}: ${subprocess.stderr.toString()}`,
		);
	}
	const line = subprocess.stdout
		.toString()
		.split("\n")
		.find((entry) => entry.trim() !== "");
	if (!line) return err("octofriend-agentd returned no response");
	const response = parseResponse(line);
	if (!response.success) return response;
	if (response.data.error) {
		return err(
			response.data.error.message ?? "octofriend-agentd request failed",
		);
	}
	return ok(response.data.result);
}

function parseResponse(line: string): Result<
	{
		result?: unknown;
		error?: { message?: string };
	},
	string
> {
	try {
		return ok(
			JSON.parse(line) as {
				result?: unknown;
				error?: { message?: string };
			},
		);
	} catch (error) {
		return err(error instanceof Error ? error.message : String(error));
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
