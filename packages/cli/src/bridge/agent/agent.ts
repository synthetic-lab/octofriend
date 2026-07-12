import type {
	AgentdAutofixEditParams,
	AgentdAutofixEditResult,
	AgentdAutofixJsonParams,
	AgentdAutofixJsonResult,
} from "./autofix.ts";
import type { AgentdModelProviderCatalogResult } from "./catalog.ts";
import type {
	AgentdCompactionCheckpointContentParams,
	AgentdCompactionCheckpointContentResult,
	AgentdCompactionDecisionParams,
	AgentdCompactionDecisionResult,
	AgentdCompactionPrepareParams,
	AgentdCompactionPrepareResult,
} from "./compaction.ts";
import type {
	AgentdConfigAutofixKeysResult,
	AgentdConfigHasExistingKeyResult,
	AgentdConfigKeyForBaseUrlParams,
	AgentdConfigKeyForModelParams,
	AgentdConfigKeyResultEnvelope,
	AgentdConfigParams,
	AgentdConfigResult,
	AgentdConfigSearchParams,
	AgentdConfigSearchResult,
	AgentdConfigWriteKeyParams,
	AgentdConfigWriteKeyResult,
} from "./config.ts";
import type {
	AgentdModelConnectionTestParams,
	AgentdModelConnectionTestResult,
} from "./connection.ts";
import type {
	AgentdConversationHistoryAppendParams,
	AgentdConversationHistoryAppendResult,
	AgentdConversationHistoryLlmPayloadsResult,
	AgentdConversationHistoryParams,
	AgentdConversationHistoryRecordsResult,
	AgentdConversationSessionCreateParams,
	AgentdConversationSessionEmptyResult,
	AgentdConversationSessionLoadResult,
	AgentdConversationSessionReplaceParams,
	AgentdConversationSessionReplaceResult,
} from "./history.ts";
import type { AgentdInitializeResult } from "./initialize.ts";
import type {
	AgentdInputHistoryAppendParams,
	AgentdInputHistoryLoadParams,
	AgentdInputHistoryResult,
} from "./input.ts";
import type {
	AgentdOctoLowerParams,
	AgentdOctoLowerResult,
} from "./octofriend.ts";
import type {
	AgentdTrajectoryArcParams,
	AgentdTrajectoryArcResult,
} from "./run-arc.ts";
import type {
	AgentdTrajectoryFinishParams,
	AgentdTrajectoryFinishResult,
} from "./run-finish.ts";
import type {
	AgentdSkillDiscoverParams,
	AgentdSkillDiscoverResult,
} from "./skills.ts";
import type {
	AgentdSyntheticQuotaFetchParams,
	AgentdSyntheticQuotaFetchResult,
} from "./synthetic-quota.ts";
import type {
	AgentdSystemPromptParams,
	AgentdSystemPromptResult,
} from "./system-prompt.ts";
import type {
	AgentdToolValidateParams,
	AgentdToolValidateResult,
} from "./tool-check.ts";
import type {
	AgentdToolDefinitionsParams,
	AgentdToolDefinitionsResult,
} from "./tool-defs.ts";
import type {
	AgentdToolPermissionParams,
	AgentdToolPermissionResult,
} from "./tool-permission.ts";
import type { AgentdToolRenderModel } from "./tool-render.ts";
import type { AgentdToolRunParams, AgentdToolRunResult } from "./tool-run.ts";
import type {
	AgentdUpdateNotificationsMarkSeenResult,
	AgentdUpdateNotificationsParams,
	AgentdUpdateNotificationsReadResult,
} from "./updates.ts";

export type {
	AgentdInputHistoryAppendParams,
	AgentdInputHistoryLoadParams,
	AgentdInputHistoryResult,
} from "./input.ts";
export type {
	AgentdDiscoveredSkill,
	AgentdSkillDiscoverParams,
	AgentdSkillDiscoverResult,
} from "./skills.ts";
export type {
	AgentdToolDefinition,
	AgentdToolDefinitionsParams,
	AgentdToolDefinitionsResult,
} from "./tool-defs.ts";
export type {
	AgentdToolPermissionParams,
	AgentdToolPermissionResult,
} from "./tool-permission.ts";
export type {
	AgentdUpdateNotificationsMarkSeenResult,
	AgentdUpdateNotificationsParams,
	AgentdUpdateNotificationsReadResult,
} from "./updates.ts";

import type {
	AgentdProviderCompilerCompleteParams,
	AgentdProviderCompilerCompleteResult,
} from "./provider.ts";

export type {
	AgentdAutofixEditParams,
	AgentdAutofixEditResult,
	AgentdAutofixJsonParams,
	AgentdAutofixJsonResult,
	AgentdAutofixUsage,
} from "./autofix.ts";
export type { AgentdModelProviderCatalogResult } from "./catalog.ts";
export type {
	AgentdCompactionCheckpointContentParams,
	AgentdCompactionCheckpointContentResult,
	AgentdCompactionDecisionParams,
	AgentdCompactionDecisionResult,
	AgentdCompactionPrepareParams,
	AgentdCompactionPrepareResult,
} from "./compaction.ts";
export type { AgentdConfigParams, AgentdConfigResult } from "./config.ts";
export type {
	AgentdModelConnectionTestParams,
	AgentdModelConnectionTestResult,
} from "./connection.ts";
export type {
	AgentdOctoLowerParams,
	AgentdOctoLowerResult,
} from "./octofriend.ts";
export type {
	AgentdProviderCompilerCompleteParams,
	AgentdProviderCompilerCompleteResult,
	AgentdProviderStreamEvent,
} from "./provider.ts";
export type {
	AgentdSyntheticQuotaFetchParams,
	AgentdSyntheticQuotaFetchResult,
} from "./synthetic-quota.ts";
export type {
	AgentdSystemPromptParams,
	AgentdSystemPromptResult,
} from "./system-prompt.ts";

import type { AgentdRequestOptions } from "../ipc/client.ts";
import { AgentdProcessClient } from "../ipc/client.ts";
import {
	type AgentdSpawnOptions,
	spawnAgentdProcess,
} from "../platform/platform.ts";
import * as configRequests from "./config-requests.ts";
import * as historyRequests from "./history-requests.ts";
import * as agentMethods from "./methods.ts";
import * as runRequests from "./run-requests.ts";
import * as toolRequests from "./tool-requests.ts";

export const AGENTD_INITIALIZE_METHOD = agentMethods.AGENTD_INITIALIZE_METHOD;
export const AGENTD_INPUT_HISTORY_LOAD_METHOD =
	agentMethods.AGENTD_INPUT_HISTORY_LOAD_METHOD;
export const AGENTD_INPUT_HISTORY_APPEND_METHOD =
	agentMethods.AGENTD_INPUT_HISTORY_APPEND_METHOD;
export const AGENTD_UPDATE_NOTIFICATIONS_READ_METHOD =
	agentMethods.AGENTD_UPDATE_NOTIFICATIONS_READ_METHOD;
export const AGENTD_UPDATE_NOTIFICATIONS_MARK_SEEN_METHOD =
	agentMethods.AGENTD_UPDATE_NOTIFICATIONS_MARK_SEEN_METHOD;
export const AGENTD_CONVERSATION_SESSION_CREATE_METHOD =
	agentMethods.AGENTD_CONVERSATION_SESSION_CREATE_METHOD;
export const AGENTD_CONVERSATION_SESSION_LOAD_METHOD =
	agentMethods.AGENTD_CONVERSATION_SESSION_LOAD_METHOD;
export const AGENTD_CONVERSATION_SESSION_REPLACE_METHOD =
	agentMethods.AGENTD_CONVERSATION_SESSION_REPLACE_METHOD;
export const AGENTD_CONVERSATION_HISTORY_APPEND_METHOD =
	agentMethods.AGENTD_CONVERSATION_HISTORY_APPEND_METHOD;
export const AGENTD_CONVERSATION_HISTORY_RECORDS_METHOD =
	agentMethods.AGENTD_CONVERSATION_HISTORY_RECORDS_METHOD;
export const AGENTD_CONVERSATION_HISTORY_LLM_PAYLOADS_METHOD =
	agentMethods.AGENTD_CONVERSATION_HISTORY_LLM_PAYLOADS_METHOD;
export const AGENTD_TRAJECTORY_ARC_METHOD =
	agentMethods.AGENTD_TRAJECTORY_ARC_METHOD;
export const AGENTD_TRAJECTORY_FINISH_METHOD =
	agentMethods.AGENTD_TRAJECTORY_FINISH_METHOD;
export const AGENTD_SYSTEM_PROMPT_METHOD =
	agentMethods.AGENTD_SYSTEM_PROMPT_METHOD;
export const AGENTD_COMPACTION_DECISION_METHOD =
	agentMethods.AGENTD_COMPACTION_DECISION_METHOD;
export const AGENTD_COMPACTION_PREPARE_METHOD =
	agentMethods.AGENTD_COMPACTION_PREPARE_METHOD;
export const AGENTD_COMPACTION_CHECKPOINT_CONTENT_METHOD =
	agentMethods.AGENTD_COMPACTION_CHECKPOINT_CONTENT_METHOD;
export const AGENTD_CONFIG_MIGRATE_METHOD =
	agentMethods.AGENTD_CONFIG_MIGRATE_METHOD;
export const AGENTD_CONFIG_SANITIZE_METHOD =
	agentMethods.AGENTD_CONFIG_SANITIZE_METHOD;
export const AGENTD_CONFIG_KEY_FOR_MODEL_METHOD =
	agentMethods.AGENTD_CONFIG_KEY_FOR_MODEL_METHOD;
export const AGENTD_CONFIG_KEY_FOR_BASE_URL_METHOD =
	agentMethods.AGENTD_CONFIG_KEY_FOR_BASE_URL_METHOD;
export const AGENTD_CONFIG_SEARCH_METHOD =
	agentMethods.AGENTD_CONFIG_SEARCH_METHOD;
export const AGENTD_CONFIG_HAS_EXISTING_KEY_METHOD =
	agentMethods.AGENTD_CONFIG_HAS_EXISTING_KEY_METHOD;
export const AGENTD_CONFIG_WRITE_KEY_METHOD =
	agentMethods.AGENTD_CONFIG_WRITE_KEY_METHOD;
export const AGENTD_CONFIG_AUTOFIX_KEYS_METHOD =
	agentMethods.AGENTD_CONFIG_AUTOFIX_KEYS_METHOD;
export const AGENTD_AUTOFIX_JSON_METHOD =
	agentMethods.AGENTD_AUTOFIX_JSON_METHOD;
export const AGENTD_AUTOFIX_EDIT_METHOD =
	agentMethods.AGENTD_AUTOFIX_EDIT_METHOD;
export const AGENTD_OCTO_LOWER_METHOD = agentMethods.AGENTD_OCTO_LOWER_METHOD;
export const AGENTD_RENDER_TOOL_CALL_METHOD =
	agentMethods.AGENTD_RENDER_TOOL_CALL_METHOD;
export const AGENTD_TOOL_DEFINITIONS_METHOD =
	agentMethods.AGENTD_TOOL_DEFINITIONS_METHOD;
export const AGENTD_TOOL_RUN_METHOD = agentMethods.AGENTD_TOOL_RUN_METHOD;
export const AGENTD_TOOL_PERMISSION_METHOD =
	agentMethods.AGENTD_TOOL_PERMISSION_METHOD;
export const AGENTD_TOOL_VALIDATE_METHOD =
	agentMethods.AGENTD_TOOL_VALIDATE_METHOD;
export const AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD =
	agentMethods.AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD;
export const AGENTD_MODEL_PROVIDER_CATALOG_METHOD =
	agentMethods.AGENTD_MODEL_PROVIDER_CATALOG_METHOD;
export const AGENTD_MODEL_CONNECTION_TEST_METHOD =
	agentMethods.AGENTD_MODEL_CONNECTION_TEST_METHOD;
export const AGENTD_SYNTHETIC_QUOTA_FETCH_METHOD =
	agentMethods.AGENTD_SYNTHETIC_QUOTA_FETCH_METHOD;
export const AGENTD_SKILL_DISCOVER_METHOD =
	agentMethods.AGENTD_SKILL_DISCOVER_METHOD;

export type {
	AgentdConversationHistoryAppendParams,
	AgentdConversationHistoryAppendResult,
	AgentdConversationHistoryEntry,
	AgentdConversationHistoryKind,
	AgentdConversationHistoryLlmPayloadsResult,
	AgentdConversationHistoryParams,
	AgentdConversationHistoryRecord,
	AgentdConversationHistoryRecordsResult,
	AgentdConversationSessionCreateParams,
	AgentdConversationSessionEmptyResult,
	AgentdConversationSessionLoadResult,
	AgentdConversationSessionMetadata,
	AgentdConversationSessionReplaceParams,
	AgentdConversationSessionReplaceResult,
} from "./history.ts";

export type {
	AgentdToolRenderModel,
	AgentdToolRunParams,
	AgentdToolRunResult,
	AgentdToolValidateParams,
	AgentdToolValidateResult,
	AgentdTrajectoryArcParams,
	AgentdTrajectoryArcResult,
	AgentdTrajectoryFinishParams,
	AgentdTrajectoryFinishResult,
};

type AgentdClientLike = {
	request: (
		method: string,
		params?: unknown,
		options?: AgentdRequestOptions,
	) => Promise<unknown>;
	close: () => void;
};

type CreateAgentdRustBridgeOptions = AgentdSpawnOptions & {
	createClient?: () => AgentdClientLike;
	onNotification?: (notification: { method: string; params?: unknown }) => void;
};

export class AgentdRustBridge {
	readonly #client: AgentdClientLike;

	constructor(client: AgentdClientLike) {
		this.#client = client;
	}

	async inputHistoryLoad(
		params: AgentdInputHistoryLoadParams = {},
	): Promise<AgentdInputHistoryResult> {
		return await historyRequests.inputHistoryLoad(this.#client, params);
	}

	async inputHistoryAppend(
		params: AgentdInputHistoryAppendParams,
	): Promise<AgentdInputHistoryResult> {
		return await historyRequests.inputHistoryAppend(this.#client, params);
	}

	async conversationSessionCreate(
		params: AgentdConversationSessionCreateParams,
	): Promise<AgentdConversationSessionEmptyResult> {
		return await historyRequests.conversationSessionCreate(
			this.#client,
			params,
		);
	}

	async conversationSessionLoad(
		params: AgentdConversationHistoryParams,
	): Promise<AgentdConversationSessionLoadResult> {
		return await historyRequests.conversationSessionLoad(this.#client, params);
	}

	async conversationSessionReplace(
		params: AgentdConversationSessionReplaceParams,
	): Promise<AgentdConversationSessionReplaceResult> {
		return await historyRequests.conversationSessionReplace(
			this.#client,
			params,
		);
	}

	async conversationHistoryAppend(
		params: AgentdConversationHistoryAppendParams,
	): Promise<AgentdConversationHistoryAppendResult> {
		return await historyRequests.conversationHistoryAppend(
			this.#client,
			params,
		);
	}

	async conversationHistoryRecords(
		params: AgentdConversationHistoryParams = {},
	): Promise<AgentdConversationHistoryRecordsResult> {
		return await historyRequests.conversationHistoryRecords(
			this.#client,
			params,
		);
	}

	async conversationHistoryLlmPayloads(
		params: AgentdConversationHistoryParams = {},
	): Promise<AgentdConversationHistoryLlmPayloadsResult> {
		return await historyRequests.conversationHistoryLlmPayloads(
			this.#client,
			params,
		);
	}

	async updateNotificationsRead(
		params: AgentdUpdateNotificationsParams = {},
	): Promise<AgentdUpdateNotificationsReadResult> {
		return await historyRequests.updateNotificationsRead(this.#client, params);
	}

	async updateNotificationsMarkSeen(
		params: AgentdUpdateNotificationsParams = {},
	): Promise<AgentdUpdateNotificationsMarkSeenResult> {
		return await historyRequests.updateNotificationsMarkSeen(
			this.#client,
			params,
		);
	}

	async trajectoryArc(
		params: AgentdTrajectoryArcParams,
		options: AgentdRequestOptions = {},
	): Promise<AgentdTrajectoryArcResult> {
		return await runRequests.trajectoryArc(this.#client, params, options);
	}

	async trajectoryFinish(
		params: AgentdTrajectoryFinishParams,
	): Promise<AgentdTrajectoryFinishResult> {
		return await runRequests.trajectoryFinish(this.#client, params);
	}

	async systemPrompt(
		params: AgentdSystemPromptParams,
	): Promise<AgentdSystemPromptResult> {
		return await runRequests.systemPrompt(this.#client, params);
	}

	async compactionDecision(
		params: AgentdCompactionDecisionParams,
	): Promise<AgentdCompactionDecisionResult> {
		return await runRequests.compactionDecision(this.#client, params);
	}

	async compactionPrepare(
		params: AgentdCompactionPrepareParams,
	): Promise<AgentdCompactionPrepareResult> {
		return await runRequests.compactionPrepare(this.#client, params);
	}

	async compactionCheckpointContent(
		params: AgentdCompactionCheckpointContentParams,
	): Promise<AgentdCompactionCheckpointContentResult> {
		return await runRequests.compactionCheckpointContent(this.#client, params);
	}

	async autofixJson(
		params: AgentdAutofixJsonParams,
	): Promise<AgentdAutofixJsonResult> {
		return await runRequests.autofixJson(this.#client, params);
	}

	async autofixEdit(
		params: AgentdAutofixEditParams,
	): Promise<AgentdAutofixEditResult> {
		return await runRequests.autofixEdit(this.#client, params);
	}

	async octoLower(
		params: AgentdOctoLowerParams,
	): Promise<AgentdOctoLowerResult> {
		return await runRequests.octoLower(this.#client, params);
	}

	async initialize(): Promise<AgentdInitializeResult> {
		return await runRequests.initialize(this.#client);
	}

	async renderToolCall(
		name: string,
		args: Record<string, unknown>,
	): Promise<AgentdToolRenderModel> {
		return await toolRequests.renderToolCall(this.#client, name, args);
	}

	async toolDefinitions(
		params: AgentdToolDefinitionsParams,
	): Promise<AgentdToolDefinitionsResult> {
		return await toolRequests.toolDefinitions(this.#client, params);
	}

	async toolRun(
		params: AgentdToolRunParams,
		options: AgentdRequestOptions = {},
	): Promise<AgentdToolRunResult> {
		return await toolRequests.toolRun(this.#client, params, options);
	}

	async toolPermission(
		params: AgentdToolPermissionParams,
	): Promise<AgentdToolPermissionResult> {
		return await toolRequests.toolPermission(this.#client, params);
	}

	async skillDiscover(
		params: AgentdSkillDiscoverParams,
	): Promise<AgentdSkillDiscoverResult> {
		return await toolRequests.skillDiscover(this.#client, params);
	}

	async toolValidate(
		params: AgentdToolValidateParams,
		options: AgentdRequestOptions = {},
	): Promise<AgentdToolValidateResult> {
		return await toolRequests.toolValidate(this.#client, params, options);
	}

	async providerCompilerComplete(
		params: AgentdProviderCompilerCompleteParams,
		options: AgentdRequestOptions = {},
	): Promise<AgentdProviderCompilerCompleteResult> {
		return await runRequests.providerCompilerComplete(
			this.#client,
			params,
			options,
		);
	}

	async modelProviderCatalog(): Promise<AgentdModelProviderCatalogResult> {
		return await runRequests.modelProviderCatalog(this.#client);
	}

	async configMigrate(params: AgentdConfigParams): Promise<AgentdConfigResult> {
		return await configRequests.configMigrate(this.#client, params);
	}

	async configSanitize(
		params: AgentdConfigParams,
	): Promise<AgentdConfigResult> {
		return await configRequests.configSanitize(this.#client, params);
	}

	async configAutofixKeys(): Promise<AgentdConfigAutofixKeysResult> {
		return await configRequests.configAutofixKeys(this.#client);
	}

	async configKeyForModel(
		params: AgentdConfigKeyForModelParams,
	): Promise<AgentdConfigKeyResultEnvelope> {
		return await configRequests.configKeyForModel(this.#client, params);
	}

	async configKeyForBaseUrl(
		params: AgentdConfigKeyForBaseUrlParams,
	): Promise<AgentdConfigKeyResultEnvelope> {
		return await configRequests.configKeyForBaseUrl(this.#client, params);
	}

	async configSearch(
		params: AgentdConfigSearchParams,
	): Promise<AgentdConfigSearchResult> {
		return await configRequests.configSearch(this.#client, params);
	}

	async configHasExistingKey(
		params: AgentdConfigKeyForBaseUrlParams,
	): Promise<AgentdConfigHasExistingKeyResult> {
		return await configRequests.configHasExistingKey(this.#client, params);
	}

	async configWriteKey(
		params: AgentdConfigWriteKeyParams,
	): Promise<AgentdConfigWriteKeyResult> {
		return await configRequests.configWriteKey(this.#client, params);
	}

	async modelDiscover(
		params: import("./connection").AgentdModelDiscoverParams,
	): Promise<import("./connection").AgentdModelDiscoverResult> {
		return await runRequests.modelDiscover(this.#client, params);
	}

	async modelConnectionTest(
		params: AgentdModelConnectionTestParams,
	): Promise<AgentdModelConnectionTestResult> {
		return await runRequests.modelConnectionTest(this.#client, params);
	}

	async syntheticQuotaFetch(
		params: AgentdSyntheticQuotaFetchParams,
	): Promise<AgentdSyntheticQuotaFetchResult> {
		return await runRequests.syntheticQuotaFetch(this.#client, params);
	}

	close(): void {
		this.#client.close();
	}
}

export function spawnAgentdProcessClient(
	options: AgentdSpawnOptions = {},
	clientOptions: {
		onNotification?: (notification: {
			method: string;
			params?: unknown;
		}) => void;
	} = {},
): AgentdProcessClient {
	return new AgentdProcessClient(spawnAgentdProcess(options), clientOptions);
}

export async function createAgentdRustBridge(
	options: CreateAgentdRustBridgeOptions = {},
): Promise<AgentdRustBridge> {
	const client =
		options.createClient?.() ??
		spawnAgentdProcessClient(options, {
			onNotification: options.onNotification,
		});
	const bridge = new AgentdRustBridge(client);
	await bridge.initialize();
	return bridge;
}
