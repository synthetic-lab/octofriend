import { err, ok, type Result } from "../../shell/result.ts";
import { resolveAgentdCommand } from "../agent/command.ts";
import { firstNonEmptyStdoutLine } from "../agent/stdout.ts";
import type { Config } from "./schemas.ts";

export function getModelFromConfig(
	config: Config,
	modelOverride: string | null,
) {
	const result = agentdRequestSync("octofriend.agentd/configSelectModel", {
		config,
		modelOverride,
	});
	if (!(result.success && isRecord(result.data))) {
		return selectModelFromConfig(config, modelOverride);
	}
	return result.data["model"] as Config["models"][number];
}

export function selectModelFromConfig(
	config: Config,
	modelOverride: string | null,
) {
	return (
		config.models.find(
			(candidate) =>
				candidate.nickname === modelOverride ||
				candidate.model === modelOverride,
		) ?? config.models[0]
	);
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
	const line = firstNonEmptyStdoutLine(subprocess.stdout.toString());
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
