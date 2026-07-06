import { createAgentdRustBridge } from "./bridge/rust/agent.ts";
import { readKeyForModelWithDetails } from "./configuration/keys.ts";
import type { Config } from "./configuration/schemas.ts";
import { exitForMissingModel, selectModel } from "./model-selection.ts";
import {
	replayProviderTokenEvents,
	runCliProviderCompletion,
} from "./provider-run.ts";
import type { Transport } from "./transport/common.ts";

export type PromptOptions = {
	model?: string;
	system?: string;
};

function exitForMissingKey(model: Config["models"][number]): never {
	console.error(`${model.nickname} doesn't have an API key set up.`);
	process.exit(1);
}

function reportKeyError(
	model: Config["models"][number],
	error: Exclude<
		Awaited<ReturnType<typeof readKeyForModelWithDetails>>,
		{ ok: true }
	>["error"],
): never {
	console.error(`${model.nickname} doesn't have an API key set up.`);
	if (error.type === "missing") {
		console.error(`${error.message}`);
		if (model.auth?.type === "env") {
			console.error(
				"Hint: do you need to re-source your .bash_profile or .zshrc?",
			);
		}
	} else if (error.type === "command_failed") {
		console.error(`Command execution failed: ${error.message}`);
		if (error.exitCode != null) console.error(`Exit code: ${error.exitCode}`);
		if (error.stderr) console.error(`stderr: ${error.stderr}`);
	} else if (error.type === "invalid") {
		console.error(`Invalid auth configuration: ${error.message}`);
	}
	process.exit(1);
}

function createTokenHandler() {
	let seenReasoning = false;
	let seenContent = false;
	return (chunk: string, type: "reasoning" | "content" | "tool") => {
		if (type === "reasoning") seenReasoning = true;
		if (seenReasoning && type === "content" && !seenContent) {
			seenContent = true;
			process.stderr.write("\n\n");
		}
		if (type === "reasoning") process.stderr.write(chunk);
		else process.stdout.write(chunk);
	};
}

export async function runPromptCommand(
	config: Config,
	transport: Transport,
	prompt: string,
	opts: PromptOptions,
) {
	const model = selectModel(config, opts.model);
	if (model == null) exitForMissingModel(config.models, opts.model);

	const keyResult = await readKeyForModelWithDetails(model, config);
	if (!keyResult.ok) reportKeyError(model, keyResult.error);
	const apiKey = keyResult.key;
	if (!apiKey) exitForMissingKey(model);

	const bridge = await createAgentdRustBridge();
	try {
		const result = await runCliProviderCompletion({
			bridge,
			apiKey,
			model,
			system: opts.system,
			cwd: transport.cwd,
			messages: [
				{
					role: "user",
					content: [{ type: "text", content: prompt }],
				},
			],
		});
		replayProviderTokenEvents(result, createTokenHandler());
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	} finally {
		bridge.close();
	}

	process.stdout.write("\n");
}
