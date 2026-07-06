import type { ImageInfo } from "../../input/image_attachments.ts";

export type ToolContract<Name extends string = string> = {
	name: Name;
	description?: string;
	providerSchema?: unknown;
};

export type ToolMap<
	_SubagentNames extends string,
	_Extra,
	_Transport = unknown,
> = Record<string, ToolContract>;

export type LoadedTools<T extends ToolMap<string, unknown, AnyTransport>> = {
	[K in keyof T]: T[K];
};

type AnyTransport = unknown;

export type ToolCall<T extends ToolMap<string, unknown, AnyTransport>> = {
	[K in keyof LoadedTools<T>]: {
		type: "tool-call";
		name: LoadedTools<T>[K]["name"];
		toolCallId: string;
		assistantMessageId: string;
		parsed: Record<string, unknown>;
		original: unknown;
	};
}[keyof LoadedTools<T>];

export type Agent<
	_Extra,
	SubagentDirectory extends AgentDirectory,
	Tools extends ToolMap<Extract<keyof SubagentDirectory, string>, _Extra>,
> = {
	tools: Tools;
	agents: SubagentDirectory;
};

export type AgentDirectory = {
	[name: string]: Agent<unknown, AgentDirectory, ToolMap<string, unknown>>;
};

export type MalformedToolRequest = {
	type: "malformed-tool-request";
	error: string;
	call: {
		original: {
			name: string;
			arguments: unknown;
		};
	};
	toolCallId: string;
};

export type AnthropicAssistantData = {
	thinkingBlocks: Array<
		| {
				type: "thinking";
				thinking: string;
				signature: string;
		  }
		| {
				type: "redacted_thinking";
				data: string;
		  }
	>;
};

export type Content = {
	content: Array<
		| {
				type: "text";
				content: string;
		  }
		| {
				type: "image";
				image: ImageInfo;
		  }
	>;
};

export type Checkpoint = Content & {
	role: "checkpoint";
};

export type LoweredCheckpoint = Content & {
	role: "lowered-checkpoint";
};

export type CompilerUsage = {
	input: {
		cached: number;
		uncached: number;
		total: number;
	};
	output: number;
};

export type AssistantMessage<T extends ToolMap<string, unknown>> = {
	role: "assistant";
	messageId: string;
	content: string;
	reasoningContent?: string | null;
	openai?: {
		encryptedReasoningContent?: string | null;
		reasoningId?: string;
	};
	anthropic?: AnthropicAssistantData;
	toolCalls?: Array<ToolCall<T> | MalformedToolRequest>;
	usage: CompilerUsage;
};

export type UserMessage = Content & {
	role: "user";
	messageId: string;
};

export type ToolOutputMessage<T extends ToolMap<string, unknown>> = Content & {
	role: "tool-output";
	toolCall: ToolCall<T>;
};

export type ToolRuntimeErrorMessage<T extends ToolMap<string, unknown>> = {
	role: "tool-runtime-error";
	toolCall: ToolCall<T>;
	error: string;
};

export type ToolValidationErrorMessage<T extends ToolMap<string, unknown>> = {
	role: "tool-validation-error";
	toolCall: ToolCall<T>;
	error: string;
	aborted: boolean;
};

export type ToolParseErrorMessage = {
	role: "tool-parse-error";
	malformedRequest: MalformedToolRequest;
};

export type ToolSkipOutputMessage<T extends ToolMap<string, unknown>> = {
	role: "tool-skip-output";
	toolCall: ToolCall<T>;
	reason: string;
};

export type ToolSubagentInvoke<
	T extends ToolMap<string, unknown>,
	SubagentName extends string,
> = {
	role: "tool-invoke-subagent";
	toolCall: ToolCall<T>;
	subagent: SubagentName;
};

export type LoweredIR<T extends ToolMap<string, unknown>> =
	| AssistantMessage<T>
	| UserMessage
	| ToolOutputMessage<T>
	| ToolRuntimeErrorMessage<T>
	| ToolValidationErrorMessage<T>
	| ToolParseErrorMessage
	| ToolSkipOutputMessage<T>
	| LoweredCheckpoint;

export type CheckpointedIR<T extends ToolMap<string, unknown>> =
	| Exclude<LoweredIR<T>, LoweredCheckpoint>
	| Checkpoint;

export type LlmIR<
	A extends Agent<unknown, AgentDirectory, ToolMap<string, unknown>>,
> = CheckpointedIR<A["tools"]>;
