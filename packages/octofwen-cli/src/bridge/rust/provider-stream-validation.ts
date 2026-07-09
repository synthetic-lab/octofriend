import type { AgentdProviderStreamState } from "./assistant-output.ts";
import type { AgentdProviderStreamEvent } from "./provider-runtime.ts";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAgentdProviderStreamEvent(
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

function isAgentdProviderStreamTokenEvent(value: UnknownRecord): boolean {
	return (
		(value["kind"] === "content" ||
			value["kind"] === "reasoning" ||
			value["kind"] === "tool") &&
		typeof value["text"] === "string"
	);
}

function isAgentdProviderStreamToolDeltaEvent(value: UnknownRecord): boolean {
	return (
		typeof value["index"] === "number" &&
		isOptionalString(value["id"]) &&
		isOptionalString(value["name"]) &&
		isOptionalString(value["arguments"])
	);
}

function isAgentdProviderStreamUsageEvent(value: UnknownRecord): boolean {
	return (
		typeof value["input"] === "number" &&
		typeof value["cachedInput"] === "number" &&
		typeof value["output"] === "number" &&
		typeof value["reasoningOutput"] === "number"
	);
}

function isAgentdOpenAiResponsesMetadataEvent(value: UnknownRecord): boolean {
	return (
		isOptionalString(value["reasoningId"]) &&
		isOptionalString(value["encryptedReasoningContent"]) &&
		isOptionalString(value["reasoningText"])
	);
}

function isAgentdGeminiThoughtSignatureEvent(value: UnknownRecord): boolean {
	return (
		typeof value["partIndex"] === "number" &&
		isOptionalString(value["toolCallId"]) &&
		typeof value["thoughtSignature"] === "string"
	);
}

function isAgentdAnthropicThinkingDeltaEvent(value: UnknownRecord): boolean {
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
