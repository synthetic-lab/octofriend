import { parseQuotaJson } from "../../app/state/quota.ts";
import { trackTokens } from "../../app/token_usage.ts";
import { readSearchConfig } from "../configuration/keys.ts";
import type { Config, ModelConfig } from "../configuration/schemas.ts";
import type { Transport } from "../transport/common.ts";
import type {
	CompactionTokenTypes,
	Finish,
	ResponseTokenTypes,
	TrajectoryHandler,
	TrajectoryOutputIR,
} from "./types.ts";

export type { AnyState, StateEvents, TrajectoryOutputIR } from "./types.ts";

type TrajectoryArcBridgeEvent =
	| { type: "start-response" }
	| {
			type: "response-progress";
			buffer: {
				content?: string | null;
				reasoning?: string | null;
				tool?: string | null;
			};
			delta: { type: ResponseTokenTypes; value: string };
	  }
	| { type: "start-compaction" }
	| {
			type: "compaction-progress";
			buffer: { content?: string | null; reasoning?: string | null };
			delta: { type: CompactionTokenTypes; value: string };
	  }
	| { type: "compaction-parsed"; checkpoint: unknown }
	| { type: "autofixing-json" }
	| { type: "autofixing-diff" }
	| { type: "quota-updated"; quota: unknown }
	| { type: "retry-tool"; irs: unknown[] }
	| { type: "token-usage"; input: number; output: number };

export type TrajectoryArcRunner = (
	params: {
		cwd: string;
		apiKey: string;
		model: Pick<
			ModelConfig,
			"type" | "baseUrl" | "model" | "context" | "reasoning" | "modalities"
		>;
		messages: readonly unknown[];
		config: {
			yourName: string;
			mcpServers?: unknown;
			search?: unknown;
			hasWebSearch?: boolean;
			skills?: { paths?: readonly string[] };
			defaultApiKeyOverrides?: Record<string, string>;
			authModels?: Array<{
				baseUrl: string;
				apiEnvVar?: string;
				auth?: unknown;
			}>;
			fixJson?: {
				baseUrl: string;
				apiEnvVar?: string;
				auth?: unknown;
				model: string;
			};
		};
		aborted?: boolean;
	},
	options?: { abortSignal?: AbortSignal; cancelOnAbort?: boolean },
) => Promise<{
	type: "finish";
	irs: unknown[];
	reason: unknown;
	events?: TrajectoryArcBridgeEvent[];
}>;

export async function trajectoryArc({
	apiKey,
	model,
	messages,
	config,
	transport,
	abortSignal,
	handler,
	trajectoryArcRun,
}: {
	apiKey: string;
	model: ModelConfig;
	messages: readonly unknown[];
	config: Config;
	transport: Transport;
	abortSignal: AbortSignal;
	handler: TrajectoryHandler;
	trajectoryArcRun: TrajectoryArcRunner;
}): Promise<Finish> {
	const searchConfig = await readSearchConfig(config);
	const fixJson = fixJsonConfig(config);
	const result = await trajectoryArcRun(
		{
			cwd: transport.cwd,
			apiKey,
			model: {
				type: model.type,
				baseUrl: model.baseUrl,
				model: model.model,
				context: model.context,
				reasoning: model.reasoning,
				modalities: model.modalities,
			},
			messages,
			config: {
				yourName: config.yourName,
				mcpServers: config.mcpServers,
				search: config.search,
				hasWebSearch: searchConfig != null,
				skills: config.skills,
				defaultApiKeyOverrides: config.defaultApiKeyOverrides,
				authModels: authModelsConfig(config),
				fixJson,
			},
			aborted: abortSignal.aborted,
		},
		{ abortSignal, cancelOnAbort: true },
	);

	emitTrajectoryArcEvents(result.events ?? [], handler, model.model);
	return {
		type: "finish",
		irs: result.irs as TrajectoryOutputIR[],
		reason: result.reason as Finish["reason"],
	};
}

function emitTrajectoryArcEvents(
	events: readonly TrajectoryArcBridgeEvent[],
	handler: TrajectoryHandler,
	model: string,
): void {
	for (const event of events) {
		switch (event.type) {
			case "start-response":
				handler.startResponse(null);
				break;
			case "response-progress":
				handler.responseProgress({
					buffer: stripNullValues(event.buffer),
					delta: event.delta,
				});
				break;
			case "start-compaction":
				handler.startCompaction(null);
				break;
			case "compaction-progress":
				handler.compactionProgress({
					type: "autocompaction-stream",
					buffer: stripNullValues(event.buffer),
					delta: event.delta,
				});
				break;
			case "compaction-parsed":
				handler.compactionParsed({
					checkpoint: event.checkpoint as Extract<
						TrajectoryOutputIR,
						{ role: "checkpoint" }
					>,
				});
				break;
			case "autofixing-json":
				handler.autofixingJson(null);
				break;
			case "autofixing-diff":
				handler.autofixingDiff(null);
				break;
			case "quota-updated": {
				const quota = parseQuotaJson(JSON.stringify(event.quota));
				if (quota) handler.onQuotaUpdated(quota);
				break;
			}
			case "retry-tool":
				handler.retryTool({ irs: event.irs as TrajectoryOutputIR[] });
				break;
			case "token-usage":
				trackTokens(model, "input", event.input);
				trackTokens(model, "output", event.output);
				break;
			default:
				break;
		}
	}
}

function stripNullValues<T extends Record<string, string | null | undefined>>(
	value: T,
): { [K in keyof T]?: string } {
	const output: Partial<Record<keyof T, string>> = {};
	for (const [key, entry] of Object.entries(value) as [
		keyof T,
		string | null | undefined,
	][]) {
		if (typeof entry === "string") output[key] = entry;
	}
	return output as { [K in keyof T]?: string };
}

function fixJsonConfig(
	config: Config,
):
	| { baseUrl: string; apiEnvVar?: string; auth?: unknown; model: string }
	| undefined {
	const model = config.fixJson;
	if (!model) return undefined;
	return {
		baseUrl: model.baseUrl,
		apiEnvVar: model.apiEnvVar,
		auth: model.auth,
		model: model.model,
	};
}

function authModelsConfig(
	config: Config,
): Array<{ baseUrl: string; apiEnvVar?: string; auth?: unknown }> {
	return [
		...config.models,
		...(config.diffApply ? [config.diffApply] : []),
		...(config.fixJson ? [config.fixJson] : []),
	].map((model) => ({
		baseUrl: model.baseUrl,
		apiEnvVar: model.apiEnvVar,
		auth: model.auth,
	}));
}
