import { resolve } from "node:path";

export const PACKAGED_AGENTD_LAUNCHER_PATH = resolve(
	import.meta.dirname,
	"../../../../cli/bin/octofriend-agentd.js",
);

export function resolveAgentdCommand(
	env: Record<string, string | undefined> = process.env,
): string[] {
	const executable = env["octofriend_AGENTD"];
	return executable
		? [executable]
		: [process.execPath, PACKAGED_AGENTD_LAUNCHER_PATH];
}
