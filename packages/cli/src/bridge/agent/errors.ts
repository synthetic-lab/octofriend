export class AgentdBridgeResponseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AgentdBridgeResponseError";
	}
}

export function invalidAgentdInitializeResponseError(): AgentdBridgeResponseError {
	return new AgentdBridgeResponseError(
		"Invalid octofriend-agentd initialize response",
	);
}

export function invalidAgentdToolRenderResponseError(): AgentdBridgeResponseError {
	return new AgentdBridgeResponseError(
		"Invalid octofriend-agentd tool render response",
	);
}

export function invalidAgentdProviderCompilerCompleteResponseError(): AgentdBridgeResponseError {
	return new AgentdBridgeResponseError(
		"Invalid octofriend-agentd provider compiler complete response",
	);
}

export function invalidAgentdModelProviderCatalogResponseError(): Error {
	return new AgentdBridgeResponseError(
		"Invalid octofriend-agentd model provider catalog response",
	);
}

export function invalidAgentdConfigResponseError(): Error {
	return new AgentdBridgeResponseError(
		"Invalid octofriend-agentd config response",
	);
}

export function invalidAgentdConfigAutofixKeysResponseError(): Error {
	return new AgentdBridgeResponseError(
		"Invalid octofriend-agentd autofix keys result",
	);
}

export function invalidAgentdModelConnectionTestResponseError(): Error {
	return new Error("Invalid octofriend-agentd model connection test response");
}

export function invalidAgentdSyntheticQuotaFetchResponseError(): Error {
	return new Error("Invalid octofriend-agentd Synthetic quota fetch response");
}

export function invalidAgentdTrajectoryFinishResponseError(): Error {
	return new Error("Invalid octofriend-agentd trajectory finish response");
}

export function invalidAgentdSystemPromptResponseError(): Error {
	return new Error("Invalid octofriend-agentd system prompt response");
}

export function invalidAgentdCompactionDecisionResponseError(): Error {
	return new Error("Invalid octofriend-agentd compaction decision response");
}

export function invalidAgentdCompactionPrepareResponseError(): Error {
	return new Error("Invalid octofriend-agentd compaction prepare response");
}

export function invalidAgentdCompactionCheckpointContentResponseError(): Error {
	return new Error(
		"Invalid octofriend-agentd compaction checkpoint content response",
	);
}

export function invalidAgentdAutofixJsonResponseError(): Error {
	return new Error("Invalid octofriend-agentd JSON autofix response");
}

export function invalidAgentdAutofixEditResponseError(): Error {
	return new Error("Invalid octofriend-agentd edit autofix response");
}

export function invalidAgentdOctoLowerResponseError(): Error {
	return new Error("Invalid octofriend-agentd Octo IR lower response");
}

export function invalidAgentdToolValidateResponseError(): Error {
	return new Error("Invalid octofriend-agentd tool validate response");
}

export function invalidAgentdToolDefinitionsResponseError(): Error {
	return new Error("Invalid octofriend-agentd tool definitions response");
}

export function invalidAgentdToolRunResponseError(): Error {
	return new Error("Invalid octofriend-agentd tool run response");
}

export function invalidAgentdToolPermissionResponseError(): Error {
	return new Error("Invalid octofriend-agentd tool permission response");
}

export function invalidAgentdSkillDiscoverResponseError(): Error {
	return new Error("Invalid octofriend-agentd skill discovery response");
}

export function invalidAgentdInputHistoryResponseError(): Error {
	return new Error("Invalid octofriend-agentd input history response");
}

export function invalidAgentdUpdateNotificationsReadResponseError(): Error {
	return new Error(
		"Invalid octofriend-agentd update notifications read response",
	);
}

export function invalidAgentdUpdateNotificationsMarkSeenResponseError(): Error {
	return new Error(
		"Invalid octofriend-agentd update notifications mark-seen response",
	);
}

export function invalidAgentdConversationSessionCreateResponseError(): Error {
	return new Error("Invalid octofriend-agentd conversation session create response");
}

export function invalidAgentdConversationSessionLoadResponseError(): Error {
	return new Error("Invalid octofriend-agentd conversation session load response");
}

export function invalidAgentdConversationSessionReplaceResponseError(): Error {
	return new Error("Invalid octofriend-agentd conversation session replace response");
}

export function invalidAgentdConversationHistoryAppendResponseError(): Error {
	return new Error(
		"Invalid octofriend-agentd conversation history append response",
	);
}

export function invalidAgentdConversationHistoryRecordsResponseError(): Error {
	return new Error(
		"Invalid octofriend-agentd conversation history records response",
	);
}

export function invalidAgentdConversationHistoryLlmPayloadsResponseError(): Error {
	return new Error(
		"Invalid octofriend-agentd conversation history LLM payloads response",
	);
}

export function invalidAgentdTrajectoryArcResponseError(): Error {
	return new Error("Invalid octofriend.agentd/trajectoryArc response");
}
