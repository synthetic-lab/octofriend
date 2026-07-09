import type {
	AgentdAssistantOutput,
	AgentdAssistantOutputResult,
	AgentdAssistantOutputUsage,
	AgentdProviderStreamState,
} from "./output";
import type { AgentdProviderType } from "./catalog";
import * as streamValidation from "./stream-check";

export type { AgentdProviderStreamState } from "./output";

type UnknownRecord = Record<string, unknown>;

export type AgentdProviderModelParams = {
	type?: AgentdProviderType;
	baseUrl: string;
	model: string;
	context: number;
	reasoning?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
	thinkingBudgetTokens?: number;
	modalities?: unknown;
	apiKey: string;
};

export type AgentdProviderPromptParams = {
	irs: readonly unknown[];
	system?: string;
	tools?: readonly AgentdProviderToolDefinition[];
};

export type AgentdProviderRuntimeParams = {
	cwd: string;
	aborted?: boolean;
	fixJson?: AgentdProviderFixJsonConfig;
	autofixJson?: AgentdProviderFixJsonConfig;
};

export type AgentdProviderCompilerCompleteParams = AgentdProviderModelParams &
	AgentdProviderPromptParams &
	AgentdProviderRuntimeParams;

export type AgentdProviderFixJsonConfig = {
	type?: AgentdProviderType;
	baseUrl: string;
	apiKey?: string;
	apiEnvVar?: string;
	auth?: unknown;
	model: string;
	defaultApiKeyOverrides?: Record<string, string>;
	authModels?: Array<{
		type?: AgentdProviderType;
		baseUrl: string;
		apiEnvVar?: string;
		auth?: unknown;
	}>;
};

export type AgentdProviderToolDefinition = {
	name: string;
	description: string;
	schema: unknown;
};

export type AgentdProviderStreamEvent =
	| {
			type: "token";
			kind: "content" | "reasoning" | "tool";
			text: string;
	  }
	| {
			type: "tool-delta";
			index: number;
			id?: string | null;
			name?: string | null;
			arguments?: string | null;
	  }
	| {
			type: "usage";
			input: number;
			cachedInput: number;
			output: number;
			reasoningOutput: number;
	  }
	| {
			type: "openai-responses-metadata";
			reasoningId?: string | null;
			encryptedReasoningContent?: string | null;
			reasoningText?: string | null;
	  }
	| {
			type: "gemini-thought-signature";
			partIndex: number;
			toolCallId?: string | null;
			thoughtSignature: string;
	  }
	| {
			type: "anthropic-thinking-delta";
			index: number;
			thinking?: string | null;
			signature?: string | null;
	  }
	| {
			type: "anthropic-redacted-thinking";
			data: string;
	  };

export type AgentdProviderCompilerStreamResult = AgentdAssistantOutputResult & {
	provider: string;
	events: readonly AgentdProviderStreamEvent[];
	state: AgentdProviderStreamState;
	unexpectedToolCall: boolean;
	headers: Record<string, string>;
};

export type AgentdProviderCompilerCompletionBase =
	AgentdProviderCompilerStreamResult & {
		curl: string;
	};

export type AgentdProviderCompilerCompleteResult =
	| (AgentdProviderCompilerCompletionBase & {
			status: "finished";
	  })
	| (AgentdProviderCompilerCompletionBase & {
			status: "error";
			error: {
				type:
					| "unexpected-tool-call"
					| "request-error"
					| "auth-error"
					| "payment-error"
					| "rate-limit-error";
				requestError: string;
				curl: string;
				usage: AgentdAssistantOutputUsage;
			};
	  });

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
	if (!isRecord(value)) return false;
	return Object.values(value).every((entry) => typeof entry === "string");
}

function _isAgentdProviderOutputResult(
	value: unknown,
): value is AgentdAssistantOutputResult {
	if (!isRecord(value)) return false;
	return (
		isAgentdAssistantOutput(value["output"]) &&
		isAgentdAssistantOutputUsage(value["usage"])
	);
}

function isAgentdAssistantOutput(
	value: unknown,
): value is AgentdAssistantOutput {
	if (!isRecord(value)) return false;
	return (
		value["role"] === "assistant" &&
		typeof value["content"] === "string" &&
		isAgentdAssistantOutputUsage(value["usage"])
	);
}

function isAgentdAssistantOutputUsage(
	value: unknown,
): value is AgentdAssistantOutputUsage {
	if (!(isRecord(value) && isRecord(value["input"]))) return false;
	return (
		typeof value["input"]["cached"] === "number" &&
		typeof value["input"]["uncached"] === "number" &&
		typeof value["input"]["total"] === "number" &&
		typeof value["output"] === "number"
	);
}

function isAgentdProviderCompilerStreamResult(
	value: unknown,
): value is AgentdProviderCompilerStreamResult {
	return (
		isRecord(value) &&
		typeof value["provider"] === "string" &&
		Array.isArray(value["events"]) &&
		value["events"].every(streamValidation.isAgentdProviderStreamEvent) &&
		streamValidation.isAgentdProviderStreamState(value["state"]) &&
		typeof value["unexpectedToolCall"] === "boolean" &&
		isAgentdAssistantOutput(value["output"]) &&
		isAgentdAssistantOutputUsage(value["usage"]) &&
		isStringRecord(value["headers"])
	);
}

function isAgentdProviderCompilerCompletionBase(
	value: unknown,
): value is AgentdProviderCompilerCompletionBase {
	if (!isRecord(value)) return false;
	return (
		isAgentdProviderCompilerStreamResult(value) &&
		typeof (value as UnknownRecord)["curl"] === "string"
	);
}

export function isAgentdProviderCompilerCompleteResult(
	value: unknown,
): value is AgentdProviderCompilerCompleteResult {
	if (!(isRecord(value) && isAgentdProviderCompilerCompletionBase(value))) {
		return false;
	}
	const record = value as UnknownRecord;
	if (record["status"] === "finished") return true;
	if (record["status"] !== "error") return false;
	const error = record["error"];
	return (
		isRecord(error) &&
		(error["type"] === "unexpected-tool-call" ||
			error["type"] === "request-error" ||
			error["type"] === "auth-error" ||
			error["type"] === "payment-error" ||
			error["type"] === "rate-limit-error") &&
		typeof error["requestError"] === "string" &&
		typeof error["curl"] === "string" &&
		isAgentdAssistantOutputUsage(error["usage"])
	);
}

export const isAgentdProviderStreamEvent =
	streamValidation.isAgentdProviderStreamEvent;
export const isAgentdProviderStreamState =
	streamValidation.isAgentdProviderStreamState;
