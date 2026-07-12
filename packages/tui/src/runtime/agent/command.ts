import { basename, dirname, join, resolve } from "node:path";

export const PACKAGED_AGENTD_LAUNCHER_PATH = resolve(
	import.meta.dirname,
	"../../../../cli/bin/octofriend-agentd.js",
);

type AgentdRuntimePaths = {
	processExecutable?: string;
	scriptPath?: string;
};

function isStandaloneExecutable(executable: string): boolean {
	const name = basename(executable).toLowerCase();
	return name !== "bun" && name !== "bun.exe";
}

function packagedLauncherPath(scriptPath: string | undefined): string {
	if (
		scriptPath &&
		["octofriend.js", "octofriend-acp.js"].includes(basename(scriptPath))
	) {
		return join(dirname(scriptPath), "octofriend-agentd.js");
	}
	return PACKAGED_AGENTD_LAUNCHER_PATH;
}

export function resolveAgentdCommand(
	env: Record<string, string | undefined> = process.env,
	runtime: AgentdRuntimePaths = {},
): string[] {
	const executable = env["octofriend_AGENTD"];
	if (executable) return [executable];
	const processExecutable = runtime.processExecutable ?? process.execPath;
	if (isStandaloneExecutable(processExecutable)) {
		return [
			join(
				dirname(processExecutable),
				process.platform === "win32"
					? "octofriend-agentd.exe"
					: "octofriend-agentd",
			),
		];
	}
	return [
		processExecutable,
		packagedLauncherPath(runtime.scriptPath ?? process.argv[1]),
	];
}
