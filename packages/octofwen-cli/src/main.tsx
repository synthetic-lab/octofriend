import { homedir } from "node:os";
import { render } from "ink";
import {
	type AgentdRustBridge,
	createAgentdRustBridge,
} from "./bridge/rust/agent.ts";
import { loadConfig } from "./config.tsx";
import type { Config } from "./configuration/schemas.ts";
import { loadInputHistory } from "./input-history.ts";
import { APP_METADATA } from "./metadata.ts";
import type { Transport } from "./transport/common.ts";
import { loadTui } from "./tui.ts";
import { markUpdatesSeen, readUpdates } from "./update-notifications.ts";

type ModelTokenUsage = { input: number; output: number };
type TokenUsageCounts = Record<string, ModelTokenUsage>;

function homeDir() {
	return process.env["HOME"] ?? process.env["USERPROFILE"] ?? homedir();
}

export type RunMainOptions = {
	config?: string;
	unchained?: boolean;
	transport: Transport;
};

async function discoverBootSkills(
	bridge: AgentdRustBridge,
	config: Config,
	transport: Transport,
) {
	const discovered = await bridge.skillDiscover({
		cwd: transport.cwd,
		home: homeDir(),
		configuredSkillPaths: config.skills?.paths ?? [],
	});
	return discovered.skills;
}

function printTokenUsage(counts: TokenUsageCounts) {
	console.log("\nApprox. tokens used:");
	if (Object.keys(counts).length === 0) {
		console.log("0");
		return;
	}

	for (const [model, count] of Object.entries(counts)) {
		const input = count.input.toLocaleString();
		const output = count.output.toLocaleString();
		console.log(`${model}: ${input} input, ${output} output`);
	}
}

export async function runMain(opts: RunMainOptions) {
	const bridge = await createAgentdRustBridge();
	const tokenUsageCounts: TokenUsageCounts = {};
	try {
		const { config, configPath } = await loadConfig(opts.config, {
			bridge,
			markUpdatesSeen: (params) => bridge.updateNotificationsMarkSeen(params),
		});
		const skills = await discoverBootSkills(bridge, config, opts.transport);
		const { App } = await loadTui();
		const inputHistory = await loadInputHistory({
			load: (params) => bridge.inputHistoryLoad(params),
			append: (params) => bridge.inputHistoryAppend(params),
		});
		if (!inputHistory.success) {
			console.error(inputHistory.error);
			process.exit(1);
		}
		const updates = await readUpdates({
			read: (params) => bridge.updateNotificationsRead(params),
		});
		if (!updates.success) {
			console.error(updates.error);
			process.exit(1);
		}
		const { waitUntilExit } = render(
			<App
				bootSkills={skills.map((skill) => skill.name)}
				config={config}
				configPath={configPath}
				cwd={opts.transport.cwd}
				metadata={APP_METADATA}
				unchained={!!opts.unchained}
				transport={opts.transport}
				updates={updates.data}
				markUpdatesSeen={async () => {
					const result = await markUpdatesSeen({
						mark: (params) => bridge.updateNotificationsMarkSeen(params),
					});
					if (!result.success) console.error(result.error);
				}}
				inputHistory={inputHistory.data}
				modelConnectionTest={(params) => bridge.modelConnectionTest(params)}
				syntheticQuotaFetch={(params) => bridge.syntheticQuotaFetch(params)}
				tokenUsageCounts={tokenUsageCounts}
				trajectoryArcRun={async (params, options) => {
					const trajectoryBridge = await createAgentdRustBridge();
					try {
						return await trajectoryBridge.trajectoryArc(params, {
							abortSignal: options?.abortSignal,
							cancelOnAbort: true,
						});
					} finally {
						trajectoryBridge.close();
					}
				}}
				toolPermission={(params) => bridge.toolPermission(params)}
				skillDiscover={(params) => bridge.skillDiscover(params)}
				toolDefinitions={(params) => bridge.toolDefinitions(params)}
				toolRun={(params, options) => bridge.toolRun(params, options)}
			/>,
			{
				exitOnCtrlC: false,
				kittyKeyboard: {
					mode: "auto",
				},
			},
		);

		await waitUntilExit();
		printTokenUsage(tokenUsageCounts);
	} finally {
		bridge.close();
	}
}
