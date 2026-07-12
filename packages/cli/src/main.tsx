import { homedir } from "node:os";
import { render } from "ink";
import {
	type AgentdRustBridge,
	createAgentdRustBridge,
} from "./bridge/agent/agent.ts";
import type { Config } from "./config/schemas.ts";
import { loadConfig } from "./config-screen.tsx";
import { loadInputHistory } from "./input.ts";
import { loadTui } from "./launch-tui.ts";
import { APP_METADATA } from "./metadata.ts";
import {
	type ConversationSessionLaunch,
	prepareConversationSession,
} from "./session.ts";
import { markUpdatesSeen, readUpdates } from "./updates.ts";
import type { Transport } from "./workspace/common.ts";

type ModelTokenUsage = { input: number; output: number };
type TokenUsageCounts = Record<string, ModelTokenUsage>;

function homeDir() {
	return process.env["HOME"] ?? process.env["USERPROFILE"] ?? homedir();
}

export type RunMainOptions = {
	config?: string;
	unchained?: boolean;
	resume?: string;
	initialPrompt?: string;
	launch: ConversationSessionLaunch;
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
		const session = await prepareConversationSession(bridge, {
			resumeId: opts.resume,
			cwd: opts.transport.cwd,
			launch: opts.launch,
		});
		if (session.launch.kind !== opts.launch.kind) {
			throw new Error(
				`Session ${session.sessionId} was launched as ${session.launch.kind}; resume it with the matching command`,
			);
		}
		const { config, configPath } = await loadConfig(session.launch.config, {
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
				unchained={session.launch.unchained}
				transport={opts.transport}
				initialSessionId={session.sessionId}
				initialHistory={session.history}
				initialPrompt={opts.initialPrompt}
				saveConversationSession={session.save}
				updates={updates.data}
				markUpdatesSeen={async () => {
					const result = await markUpdatesSeen({
						mark: (params) => bridge.updateNotificationsMarkSeen(params),
					});
					if (!result.success) console.error(result.error);
				}}
				inputHistory={inputHistory.data}
				modelConnectionTest={(params) => bridge.modelConnectionTest(params)}
				modelDiscover={(params) => bridge.modelDiscover(params)}
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
		await session.flush();
		printTokenUsage(tokenUsageCounts);
	} finally {
		bridge.close();
	}
}
