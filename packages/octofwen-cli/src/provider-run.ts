import type { AgentdRustBridge } from "./bridge/rust/agent.ts";
import type {
	AgentdProviderCompilerCompleteResult,
	AgentdProviderStreamEvent,
} from "./bridge/rust/provider-runtime.ts";
import type { Config } from "./configuration/schemas.ts";

export type CliProviderMessage = {
	role: "user" | "assistant" | "system" | "tool";
	content: unknown;
};

export type CliProviderModel = Config["models"][number];

export type CliProviderRunParams = {
	bridge: AgentdRustBridge;
	apiKey: string;
	model: CliProviderModel;
	messages: readonly CliProviderMessage[];
	system?: string;
	cwd: string;
};

export async function runCliProviderCompletion({
	bridge,
	apiKey,
	model,
	messages,
	system,
	cwd,
}: CliProviderRunParams): Promise<
	Extract<AgentdProviderCompilerCompleteResult, { status: "finished" }>
> {
	const result = await bridge.providerCompilerComplete({
		type: model.type,
		baseUrl: model.baseUrl,
		model: model.model,
		context: model.context,
		reasoning: model.reasoning,
		modalities: model.modalities,
		apiKey,
		irs: messages,
		system,
		cwd,
	});
	if (result.status === "error") {
		throw new Error(result.error.requestError);
	}
	return result;
}

export function replayProviderTokenEvents(
	result: AgentdProviderCompilerCompleteResult,
	onToken: (text: string, kind: "content" | "reasoning" | "tool") => void,
): void {
	for (const event of result.events) {
		if (isTokenEvent(event)) onToken(event.text, event.kind);
	}
}

function isTokenEvent(
	event: AgentdProviderStreamEvent,
): event is Extract<AgentdProviderStreamEvent, { type: "token" }> {
	return event.type === "token";
}
