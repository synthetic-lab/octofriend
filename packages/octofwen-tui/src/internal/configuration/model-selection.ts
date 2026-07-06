import { resolveAgentdCommand } from "../agentd/command.ts";
import { err, ok, type Result } from "../../app/result.ts";
import type { Config } from "./schemas.ts";

export function getModelFromConfig(
	config: Config,
	modelOverride: string | null,
) {
	const result = agentdRequestSync("octofwen.agentd/configSelectModel", {
		config,
		modelOverride,
	});
	if (!result.success || !isRecord(result.data)) {
		return config.models[0];
	}
	return result.data["model"] as Config["models"][number];
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
			`octofwen-agentd exited with code ${subprocess.exitCode}: ${subprocess.stderr.toString()}`,
		);
	}
	const line = subprocess.stdout
		.toString()
		.split("\n")
		.find((entry) => entry.trim() !== "");
	if (!line) return err("octofwen-agentd returned no response");
	const response = parseResponse(line);
	if (!response.success) return response;
	if (response.data.error) {
		return err(response.data.error.message ?? "octofwen-agentd request failed");
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
