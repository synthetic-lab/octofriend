import { resolveAgentdCommand } from "../agentd/command.ts";
import type { Config } from "./schemas.ts";

export function getModelFromConfig(
	config: Config,
	modelOverride: string | null,
) {
	const result = agentdRequestSync("octofwen.agentd/configSelectModel", {
		config,
		modelOverride,
	});
	if (!isRecord(result))
		throw new Error("Invalid octofwen-agentd model result");
	return result["model"] as Config["models"][number];
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
