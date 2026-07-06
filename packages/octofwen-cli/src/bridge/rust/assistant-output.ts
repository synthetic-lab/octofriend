export type AgentdAssistantOutputUsage = {
	input: {
		cached: number;
		uncached: number;
		total: number;
	};
	output: number;
};

export type AgentdAssistantOutput = {
	role: "assistant";
	content: string;
	reasoningContent?: string | null;
	usage: AgentdAssistantOutputUsage;
	toolCalls?: unknown[];
	openai?: {
		encryptedReasoningContent?: string | null;
		reasoningId?: string;
	};
	anthropic?: {
		thinkingBlocks: Array<
			| { type: "thinking"; thinking: string; signature: string }
			| { type: "redacted_thinking"; data: string }
		>;
	};
};

export type AgentdProviderStreamUsage = {
	input: number;
	cachedInput: number;
	output: number;
	reasoningOutput: number;
};

export type AgentdProviderStreamTool = {
	index: number;
	id?: string | null;
	name?: string | null;
	arguments?: string | null;
};

export type AgentdProviderStreamState = {
	content: string;
	reasoningContent?: string | null;
	usage: AgentdProviderStreamUsage;
	tools: AgentdProviderStreamTool[];
	openai: {
		reasoningId?: string | null;
		encryptedReasoningContent?: string | null;
	};
	anthropic: {
		thinkingBlocks: Array<
			| {
					type: "thinking";
					index: number;
					thinking: string;
					signature?: string | null;
			  }
			| { type: "redacted_thinking"; data: string }
		>;
	};
};

export type AgentdAssistantOutputResult = {
	output: AgentdAssistantOutput;
	usage: AgentdAssistantOutputUsage;
};
