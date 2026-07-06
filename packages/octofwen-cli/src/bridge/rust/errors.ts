export class AgentdBridgeResponseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AgentdBridgeResponseError";
	}
}

export function invalidAgentdInitializeResponseError(): AgentdBridgeResponseError {
	return new AgentdBridgeResponseError(
		"Invalid octofwen-agentd initialize response",
	);
}

export function invalidAgentdToolRenderResponseError(): AgentdBridgeResponseError {
	return new AgentdBridgeResponseError(
		"Invalid octofwen-agentd tool render response",
	);
}

export function invalidAgentdProviderCompilerCompleteResponseError(): AgentdBridgeResponseError {
	return new AgentdBridgeResponseError(
		"Invalid octofwen-agentd provider compiler complete response",
	);
}

export function invalidAgentdModelProviderCatalogResponseError(): Error {
	return new AgentdBridgeResponseError(
		"Invalid octofwen-agentd model provider catalog response",
	);
}

export function invalidAgentdConfigResponseError(): Error {
	return new AgentdBridgeResponseError(
		"Invalid octofwen-agentd config response",
	);
}

export function invalidAgentdModelConnectionTestResponseError(): Error {
	return new Error("Invalid octofwen-agentd model connection test response");
}

export function invalidAgentdSyntheticQuotaFetchResponseError(): Error {
	return new Error("Invalid octofwen-agentd Synthetic quota fetch response");
}

export function invalidAgentdTrajectoryFinishResponseError(): Error {
	return new Error("Invalid octofwen-agentd trajectory finish response");
}

export function invalidAgentdSystemPromptResponseError(): Error {
	return new Error("Invalid octofwen-agentd system prompt response");
}

export function invalidAgentdCompactionDecisionResponseError(): Error {
	return new Error("Invalid octofwen-agentd compaction decision response");
}

export function invalidAgentdCompactionPrepareResponseError(): Error {
	return new Error("Invalid octofwen-agentd compaction prepare response");
}

export function invalidAgentdCompactionCheckpointContentResponseError(): Error {
	return new Error(
		"Invalid octofwen-agentd compaction checkpoint content response",
	);
}

export function invalidAgentdAutofixJsonResponseError(): Error {
	return new Error("Invalid octofwen-agentd JSON autofix response");
}

export function invalidAgentdAutofixEditResponseError(): Error {
	return new Error("Invalid octofwen-agentd edit autofix response");
}

export function invalidAgentdOctoLowerResponseError(): Error {
	return new Error("Invalid octofwen-agentd Octo IR lower response");
}

export function invalidAgentdToolValidateResponseError(): Error {
	return new Error("Invalid octofwen-agentd tool validate response");
}

export function invalidAgentdToolDefinitionsResponseError(): Error {
	return new Error("Invalid octofwen-agentd tool definitions response");
}

export function invalidAgentdToolRunResponseError(): Error {
	return new Error("Invalid octofwen-agentd tool run response");
}

export function invalidAgentdToolPermissionResponseError(): Error {
	return new Error("Invalid octofwen-agentd tool permission response");
}

export function invalidAgentdSkillDiscoverResponseError(): Error {
	return new Error("Invalid octofwen-agentd skill discovery response");
}

export function invalidAgentdInputHistoryResponseError(): Error {
	return new Error("Invalid octofwen-agentd input history response");
}

export function invalidAgentdUpdateNotificationsReadResponseError(): Error {
	return new Error(
		"Invalid octofwen-agentd update notifications read response",
	);
}

export function invalidAgentdUpdateNotificationsMarkSeenResponseError(): Error {
	return new Error(
		"Invalid octofwen-agentd update notifications mark-seen response",
	);
}

export function invalidAgentdConversationHistoryAppendResponseError(): Error {
	return new Error(
		"Invalid octofwen-agentd conversation history append response",
	);
}

export function invalidAgentdConversationHistoryRecordsResponseError(): Error {
	return new Error(
		"Invalid octofwen-agentd conversation history records response",
	);
}

export function invalidAgentdConversationHistoryLlmPayloadsResponseError(): Error {
	return new Error(
		"Invalid octofwen-agentd conversation history LLM payloads response",
	);
}

export function invalidAgentdTrajectoryArcResponseError(): Error {
	return new Error("Invalid octofwen.agentd/trajectoryArc response");
}
