import * as agentMethods from "./methods";
import { type AgentdRequestClient, requestAgentdResult } from "./agent-check";
import {
	type AgentdConversationHistoryAppendParams,
	type AgentdConversationHistoryAppendResult,
	type AgentdConversationHistoryLlmPayloadsResult,
	type AgentdConversationHistoryParams,
	type AgentdConversationHistoryRecordsResult,
	type AgentdConversationSessionCreateParams,
	type AgentdConversationSessionEmptyResult,
	type AgentdConversationSessionLoadResult,
	type AgentdConversationSessionReplaceParams,
	type AgentdConversationSessionReplaceResult,
	isAgentdConversationHistoryAppendResult,
	isAgentdConversationHistoryLlmPayloadsResult,
	isAgentdConversationHistoryRecordsResult,
	isAgentdConversationSessionEmptyResult,
	isAgentdConversationSessionLoadResult,
	isAgentdConversationSessionReplaceResult,
} from "./history";
import {
	invalidAgentdConversationHistoryAppendResponseError,
	invalidAgentdConversationHistoryLlmPayloadsResponseError,
	invalidAgentdConversationHistoryRecordsResponseError,
	invalidAgentdConversationSessionCreateResponseError,
	invalidAgentdConversationSessionLoadResponseError,
	invalidAgentdConversationSessionReplaceResponseError,
	invalidAgentdInputHistoryResponseError,
	invalidAgentdUpdateNotificationsMarkSeenResponseError,
	invalidAgentdUpdateNotificationsReadResponseError,
} from "./errors";
import {
	type AgentdInputHistoryAppendParams,
	type AgentdInputHistoryLoadParams,
	type AgentdInputHistoryResult,
	isAgentdInputHistoryResult,
} from "./input";
import {
	type AgentdUpdateNotificationsMarkSeenResult,
	type AgentdUpdateNotificationsParams,
	type AgentdUpdateNotificationsReadResult,
	isAgentdUpdateNotificationsMarkSeenResult,
	isAgentdUpdateNotificationsReadResult,
} from "./updates";

export async function inputHistoryLoad(
	client: AgentdRequestClient,
	params: AgentdInputHistoryLoadParams,
): Promise<AgentdInputHistoryResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_INPUT_HISTORY_LOAD_METHOD,
		params,
		isAgentdInputHistoryResult,
		invalidAgentdInputHistoryResponseError,
	);
}

export async function inputHistoryAppend(
	client: AgentdRequestClient,
	params: AgentdInputHistoryAppendParams,
): Promise<AgentdInputHistoryResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_INPUT_HISTORY_APPEND_METHOD,
		params,
		isAgentdInputHistoryResult,
		invalidAgentdInputHistoryResponseError,
	);
}

export async function conversationSessionCreate(
	client: AgentdRequestClient,
	params: AgentdConversationSessionCreateParams,
): Promise<AgentdConversationSessionEmptyResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_CONVERSATION_SESSION_CREATE_METHOD,
		params,
		isAgentdConversationSessionEmptyResult,
		invalidAgentdConversationSessionCreateResponseError,
	);
}

export async function conversationSessionLoad(
	client: AgentdRequestClient,
	params: AgentdConversationHistoryParams,
): Promise<AgentdConversationSessionLoadResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_CONVERSATION_SESSION_LOAD_METHOD,
		params,
		isAgentdConversationSessionLoadResult,
		invalidAgentdConversationSessionLoadResponseError,
	);
}

export async function conversationSessionReplace(
	client: AgentdRequestClient,
	params: AgentdConversationSessionReplaceParams,
): Promise<AgentdConversationSessionReplaceResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_CONVERSATION_SESSION_REPLACE_METHOD,
		params,
		isAgentdConversationSessionReplaceResult,
		invalidAgentdConversationSessionReplaceResponseError,
	);
}

export async function conversationHistoryAppend(
	client: AgentdRequestClient,
	params: AgentdConversationHistoryAppendParams,
): Promise<AgentdConversationHistoryAppendResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_CONVERSATION_HISTORY_APPEND_METHOD,
		params,
		isAgentdConversationHistoryAppendResult,
		invalidAgentdConversationHistoryAppendResponseError,
	);
}

export async function conversationHistoryRecords(
	client: AgentdRequestClient,
	params: AgentdConversationHistoryParams,
): Promise<AgentdConversationHistoryRecordsResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_CONVERSATION_HISTORY_RECORDS_METHOD,
		params,
		isAgentdConversationHistoryRecordsResult,
		invalidAgentdConversationHistoryRecordsResponseError,
	);
}

export async function conversationHistoryLlmPayloads(
	client: AgentdRequestClient,
	params: AgentdConversationHistoryParams,
): Promise<AgentdConversationHistoryLlmPayloadsResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_CONVERSATION_HISTORY_LLM_PAYLOADS_METHOD,
		params,
		isAgentdConversationHistoryLlmPayloadsResult,
		invalidAgentdConversationHistoryLlmPayloadsResponseError,
	);
}

export async function updateNotificationsRead(
	client: AgentdRequestClient,
	params: AgentdUpdateNotificationsParams,
): Promise<AgentdUpdateNotificationsReadResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_UPDATE_NOTIFICATIONS_READ_METHOD,
		params,
		isAgentdUpdateNotificationsReadResult,
		invalidAgentdUpdateNotificationsReadResponseError,
	);
}

export async function updateNotificationsMarkSeen(
	client: AgentdRequestClient,
	params: AgentdUpdateNotificationsParams,
): Promise<AgentdUpdateNotificationsMarkSeenResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_UPDATE_NOTIFICATIONS_MARK_SEEN_METHOD,
		params,
		isAgentdUpdateNotificationsMarkSeenResult,
		invalidAgentdUpdateNotificationsMarkSeenResponseError,
	);
}
