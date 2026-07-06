import type {
	AgentdAssistantOutput,
	AgentdAssistantOutputResult,
	AgentdAssistantOutputUsage,
	AgentdProviderStreamState,
} from "./assistant-output.ts";

export type { AgentdProviderStreamState } from "./assistant-output.ts";

export type AgentdProviderCompilerCompleteParams = {
	type?: "standard" | "openai-responses" | "anthropic" | "gemini";
	baseUrl: string;
	model: string;
	context: number;
	reasoning?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
	thinkingBudgetTokens?: number;
	modalities?: unknown;
	apiKey: string;
	irs: readonly unknown[];
	system?: string;
	tools?: readonly AgentdProviderToolDefinition[];
	cwd: string;
	aborted?: boolean;
	autofixJson?: {
		baseUrl: string;
		apiKey: string;
		model: string;
	};
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

function isRecord(value: unknown): value is Record<string, unknown> {
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
		value["events"].every(isAgentdProviderStreamEvent) &&
		isAgentdProviderStreamState(value["state"]) &&
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
		typeof (value as Record<string, unknown>)["curl"] === "string"
	);
}

export function isAgentdProviderCompilerCompleteResult(
	value: unknown,
): value is AgentdProviderCompilerCompleteResult {
	if (!(isRecord(value) && isAgentdProviderCompilerCompletionBase(value))) {
		return false;
	}
	const record = value as Record<string, unknown>;
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

function isAgentdProviderStreamEvent(
	value: unknown,
): value is AgentdProviderStreamEvent {
	if (!isRecord(value) || typeof value["type"] !== "string") return false;

	switch (value["type"]) {
		case "token":
			return isAgentdProviderStreamTokenEvent(value);
		case "tool-delta":
			return isAgentdProviderStreamToolDeltaEvent(value);
		case "usage":
			return isAgentdProviderStreamUsageEvent(value);
		case "openai-responses-metadata":
			return isAgentdOpenAiResponsesMetadataEvent(value);
		case "gemini-thought-signature":
			return isAgentdGeminiThoughtSignatureEvent(value);
		case "anthropic-thinking-delta":
			return isAgentdAnthropicThinkingDeltaEvent(value);
		case "anthropic-redacted-thinking":
			return typeof value["data"] === "string";
		default:
			return false;
	}
}

function isAgentdProviderStreamTokenEvent(
	value: Record<string, unknown>,
): boolean {
	return (
		(value["kind"] === "content" ||
			value["kind"] === "reasoning" ||
			value["kind"] === "tool") &&
		typeof value["text"] === "string"
	);
}

function isAgentdProviderStreamToolDeltaEvent(
	value: Record<string, unknown>,
): boolean {
	return (
		typeof value["index"] === "number" &&
		isOptionalString(value["id"]) &&
		isOptionalString(value["name"]) &&
		isOptionalString(value["arguments"])
	);
}

function isAgentdProviderStreamUsageEvent(
	value: Record<string, unknown>,
): boolean {
	return (
		typeof value["input"] === "number" &&
		typeof value["cachedInput"] === "number" &&
		typeof value["output"] === "number" &&
		typeof value["reasoningOutput"] === "number"
	);
}

function isAgentdOpenAiResponsesMetadataEvent(
	value: Record<string, unknown>,
): boolean {
	return (
		isOptionalString(value["reasoningId"]) &&
		isOptionalString(value["encryptedReasoningContent"]) &&
		isOptionalString(value["reasoningText"])
	);
}

function isAgentdGeminiThoughtSignatureEvent(
	value: Record<string, unknown>,
): boolean {
	return (
		typeof value["partIndex"] === "number" &&
		isOptionalString(value["toolCallId"]) &&
		typeof value["thoughtSignature"] === "string"
	);
}

function isAgentdAnthropicThinkingDeltaEvent(
	value: Record<string, unknown>,
): boolean {
	return (
		typeof value["index"] === "number" &&
		isOptionalString(value["thinking"]) &&
		isOptionalString(value["signature"])
	);
}

export function isAgentdProviderStreamState(
	value: unknown,
): value is AgentdProviderStreamState {
	if (!isRecord(value)) return false;
	const reasoningContent = value["reasoningContent"];
	const tools = value["tools"];
	return (
		typeof value["content"] === "string" &&
		(reasoningContent === undefined ||
			reasoningContent === null ||
			typeof reasoningContent === "string") &&
		isAgentdProviderStreamUsage(value["usage"]) &&
		Array.isArray(tools) &&
		tools.every(isAgentdProviderStreamTool) &&
		isAgentdProviderOpenAiState(value["openai"]) &&
		isAgentdProviderAnthropicState(value["anthropic"]) &&
		isAgentdProviderGeminiState(value["gemini"])
	);
}

function isAgentdProviderStreamUsage(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value["input"] === "number" &&
		typeof value["cachedInput"] === "number" &&
		typeof value["output"] === "number" &&
		typeof value["reasoningOutput"] === "number"
	);
}

function isAgentdProviderStreamTool(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value["index"] === "number" &&
		isOptionalString(value["id"]) &&
		isOptionalString(value["name"]) &&
		isOptionalString(value["arguments"])
	);
}

function isOptionalString(value: unknown): boolean {
	return value === undefined || value === null || typeof value === "string";
}

function isAgentdProviderOpenAiState(value: unknown): boolean {
	return (
		isRecord(value) &&
		isOptionalString(value["reasoningId"]) &&
		isOptionalString(value["encryptedReasoningContent"])
	);
}

function isAgentdProviderAnthropicState(value: unknown): boolean {
	if (!isRecord(value)) return false;
	const thinkingBlocks = value["thinkingBlocks"];
	return (
		Array.isArray(thinkingBlocks) &&
		thinkingBlocks.every(isAgentdProviderAnthropicThinkingBlock)
	);
}

function isAgentdProviderAnthropicThinkingBlock(value: unknown): boolean {
	if (!isRecord(value)) return false;
	if (value["type"] === "thinking") {
		return (
			typeof value["index"] === "number" &&
			typeof value["thinking"] === "string" &&
			isOptionalString(value["signature"])
		);
	}
	if (value["type"] === "redacted_thinking") {
		return typeof value["data"] === "string";
	}
	return false;
}

function isAgentdProviderGeminiState(value: unknown): boolean {
	if (value === undefined) return true;
	if (!isRecord(value)) return false;
	const thoughtSignatures = value["thoughtSignatures"];
	return (
		Array.isArray(thoughtSignatures) &&
		thoughtSignatures.every(isAgentdGeminiThoughtSignature)
	);
}

function isAgentdGeminiThoughtSignature(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value["partIndex"] === "number" &&
		isOptionalString(value["toolCallId"]) &&
		typeof value["thoughtSignature"] === "string"
	);
}
