import type { ToolCall as ToolCallRequest } from "../runtime/tools/main.ts";

type ParsedToolIdentityArguments = {
	server?: string;
	tool?: string;
	filePath?: string;
	cmd?: string;
	skillName?: string;
	path?: string;
	dirPath?: string;
	url?: string;
};

type ParsedSearchArguments = {
	includeName?: string;
	includePath?: string;
	maxDepth?: number;
	pattern?: string;
	caseInsensitive?: boolean;
	context?: number;
	maxResults?: number;
	timeout?: number;
};

type ParsedEditArguments = {
	search?: string;
	replace?: string;
	originalFileContents?: string;
	text?: string;
	content?: string;
};

type ParsedNestedArguments = {
	arguments?: unknown;
	[key: string]: unknown;
};

export type ParsedToolCallArguments = ParsedToolIdentityArguments &
	ParsedSearchArguments &
	ParsedEditArguments &
	ParsedNestedArguments;

export type ParsedToolCallSchema = {
	name: ToolCallRequest["name"];
	arguments: ParsedToolCallArguments;
};

export function parsedToolSchema(
	toolCall: ToolCallRequest,
): ParsedToolCallSchema {
	return {
		name: toolCall.name,
		arguments: toolCall.parsed as ParsedToolCallSchema["arguments"],
	};
}

export function parsedItemFor<T>(toolCall: ToolCallRequest): T {
	return parsedToolSchema(toolCall) as unknown as T;
}
