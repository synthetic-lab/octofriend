import {
	type AgentdAutofixEditParams,
	type AgentdAutofixEditResult,
	type AgentdAutofixJsonParams,
	type AgentdAutofixJsonResult,
	isAgentdAutofixEditResult,
	isAgentdAutofixJsonResult,
} from "./autofix.ts";
import {
	type AgentdCompactionCheckpointContentParams,
	type AgentdCompactionCheckpointContentResult,
	type AgentdCompactionDecisionParams,
	type AgentdCompactionDecisionResult,
	type AgentdCompactionPrepareParams,
	type AgentdCompactionPrepareResult,
	isAgentdCompactionCheckpointContentResult,
	isAgentdCompactionDecisionResult,
	isAgentdCompactionPrepareResult,
} from "./compaction-decision.ts";
import {
	type AgentdConfigHasExistingKeyResult,
	type AgentdConfigKeyForBaseUrlParams,
	type AgentdConfigKeyForModelParams,
	type AgentdConfigKeyResultEnvelope,
	type AgentdConfigParams,
	type AgentdConfigResult,
	type AgentdConfigSearchParams,
	type AgentdConfigSearchResult,
	type AgentdConfigWriteKeyParams,
	type AgentdConfigWriteKeyResult,
	isAgentdConfigHasExistingKeyResult,
	isAgentdConfigKeyResultEnvelope,
	isAgentdConfigResult,
	isAgentdConfigSearchResult,
	isAgentdConfigWriteKeyResult,
} from "./config.ts";
import {
	type AgentdConversationHistoryAppendParams,
	type AgentdConversationHistoryAppendResult,
	type AgentdConversationHistoryLlmPayloadsResult,
	type AgentdConversationHistoryParams,
	type AgentdConversationHistoryRecordsResult,
	isAgentdConversationHistoryAppendResult,
	isAgentdConversationHistoryLlmPayloadsResult,
	isAgentdConversationHistoryRecordsResult,
} from "./conversation-history.ts";
import {
	type AgentdInitializeResult,
	isAgentdInitializeResult,
} from "./initialize.ts";
import {
	type AgentdInputHistoryAppendParams,
	type AgentdInputHistoryLoadParams,
	type AgentdInputHistoryResult,
	isAgentdInputHistoryResult,
} from "./input-history.ts";
import {
	type AgentdModelProviderCatalogResult,
	isAgentdModelProviderCatalogResult,
} from "./model-catalog.ts";
import {
	type AgentdModelConnectionTestParams,
	type AgentdModelConnectionTestResult,
	isAgentdModelConnectionTestResult,
} from "./model-connection.ts";
import {
	type AgentdOctoLowerParams,
	type AgentdOctoLowerResult,
	isAgentdOctoLowerResult,
} from "./octo-lower.ts";
import {
	type AgentdSkillDiscoverParams,
	type AgentdSkillDiscoverResult,
	isAgentdSkillDiscoverResult,
} from "./skill-discovery.ts";
import {
	type AgentdSyntheticQuotaFetchParams,
	type AgentdSyntheticQuotaFetchResult,
	isAgentdSyntheticQuotaFetchResult,
} from "./synthetic-quota.ts";
import {
	type AgentdSystemPromptParams,
	type AgentdSystemPromptResult,
	isAgentdSystemPromptResult,
} from "./system-prompt.ts";
import {
	type AgentdToolDefinitionsParams,
	type AgentdToolDefinitionsResult,
	isAgentdToolDefinitionsResult,
} from "./tool-definitions.ts";
import {
	type AgentdToolPermissionParams,
	type AgentdToolPermissionResult,
	isAgentdToolPermissionResult,
} from "./tool-permission.ts";
import {
	type AgentdToolRenderModel,
	isAgentdToolRenderModel,
} from "./tool-render.ts";
import {
	type AgentdToolRunParams,
	type AgentdToolRunResult,
	isAgentdToolRunResult,
} from "./tool-run.ts";
import {
	type AgentdToolValidateParams,
	type AgentdToolValidateResult,
	isAgentdToolValidateResult,
} from "./tool-validate.ts";
import {
	type AgentdTrajectoryArcParams,
	type AgentdTrajectoryArcResult,
	isAgentdTrajectoryArcResult,
} from "./trajectory-arc.ts";
import {
	type AgentdTrajectoryFinishParams,
	type AgentdTrajectoryFinishResult,
	isAgentdTrajectoryFinishResult,
} from "./trajectory-finish.ts";
import {
	type AgentdUpdateNotificationsMarkSeenResult,
	type AgentdUpdateNotificationsParams,
	type AgentdUpdateNotificationsReadResult,
	isAgentdUpdateNotificationsMarkSeenResult,
	isAgentdUpdateNotificationsReadResult,
} from "./update-notifications.ts";

export type {
	AgentdInputHistoryAppendParams,
	AgentdInputHistoryLoadParams,
	AgentdInputHistoryResult,
} from "./input-history.ts";
export type {
	AgentdDiscoveredSkill,
	AgentdSkillDiscoverParams,
	AgentdSkillDiscoverResult,
} from "./skill-discovery.ts";
export type {
	AgentdToolDefinition,
	AgentdToolDefinitionsParams,
	AgentdToolDefinitionsResult,
} from "./tool-definitions.ts";
export type {
	AgentdToolPermissionParams,
	AgentdToolPermissionResult,
} from "./tool-permission.ts";
export type {
	AgentdUpdateNotificationsMarkSeenResult,
	AgentdUpdateNotificationsParams,
	AgentdUpdateNotificationsReadResult,
} from "./update-notifications.ts";

import type {
	AgentdProviderCompilerCompleteParams,
	AgentdProviderCompilerCompleteResult,
} from "./provider-runtime.ts";
import { isAgentdProviderCompilerCompleteResult } from "./provider-runtime.ts";

export type {
	AgentdAutofixEditParams,
	AgentdAutofixEditResult,
	AgentdAutofixJsonParams,
	AgentdAutofixJsonResult,
	AgentdAutofixUsage,
} from "./autofix.ts";
export type {
	AgentdCompactionCheckpointContentParams,
	AgentdCompactionCheckpointContentResult,
	AgentdCompactionDecisionParams,
	AgentdCompactionDecisionResult,
	AgentdCompactionPrepareParams,
	AgentdCompactionPrepareResult,
} from "./compaction-decision.ts";
export type { AgentdConfigParams, AgentdConfigResult } from "./config.ts";
export type { AgentdModelProviderCatalogResult } from "./model-catalog.ts";
export type {
	AgentdModelConnectionTestParams,
	AgentdModelConnectionTestResult,
} from "./model-connection.ts";
export type {
	AgentdOctoLowerParams,
	AgentdOctoLowerResult,
} from "./octo-lower.ts";
export type {
	AgentdProviderCompilerCompleteParams,
	AgentdProviderCompilerCompleteResult,
	AgentdProviderStreamEvent,
} from "./provider-runtime.ts";
export type {
	AgentdSyntheticQuotaFetchParams,
	AgentdSyntheticQuotaFetchResult,
} from "./synthetic-quota.ts";
export type {
	AgentdSystemPromptParams,
	AgentdSystemPromptResult,
} from "./system-prompt.ts";

import { err, ok, type Result } from "../../result.ts";
import {
	type AgentdSpawnOptions,
	spawnAgentdProcess,
} from "../node/platform.ts";
import type { AgentdRequestOptions } from "../process/client.ts";
import { AgentdProcessClient } from "../process/client.ts";
import {
	invalidAgentdAutofixEditResponseError,
	invalidAgentdAutofixJsonResponseError,
	invalidAgentdCompactionCheckpointContentResponseError,
	invalidAgentdCompactionDecisionResponseError,
	invalidAgentdCompactionPrepareResponseError,
	invalidAgentdConfigResponseError,
	invalidAgentdConversationHistoryAppendResponseError,
	invalidAgentdConversationHistoryLlmPayloadsResponseError,
	invalidAgentdConversationHistoryRecordsResponseError,
	invalidAgentdInitializeResponseError,
	invalidAgentdInputHistoryResponseError,
	invalidAgentdModelConnectionTestResponseError,
	invalidAgentdModelProviderCatalogResponseError,
	invalidAgentdOctoLowerResponseError,
	invalidAgentdProviderCompilerCompleteResponseError,
	invalidAgentdSkillDiscoverResponseError,
	invalidAgentdSyntheticQuotaFetchResponseError,
	invalidAgentdSystemPromptResponseError,
	invalidAgentdToolDefinitionsResponseError,
	invalidAgentdToolPermissionResponseError,
	invalidAgentdToolRenderResponseError,
	invalidAgentdToolRunResponseError,
	invalidAgentdToolValidateResponseError,
	invalidAgentdTrajectoryArcResponseError,
	invalidAgentdTrajectoryFinishResponseError,
	invalidAgentdUpdateNotificationsMarkSeenResponseError,
	invalidAgentdUpdateNotificationsReadResponseError,
} from "./errors.ts";

export const AGENTD_INITIALIZE_METHOD = "octofwen.agentd/initialize";
export const AGENTD_INPUT_HISTORY_LOAD_METHOD =
	"octofwen.agentd/inputHistoryLoad";
export const AGENTD_INPUT_HISTORY_APPEND_METHOD =
	"octofwen.agentd/inputHistoryAppend";
export const AGENTD_UPDATE_NOTIFICATIONS_READ_METHOD =
	"octofwen.agentd/updateNotificationsRead";
export const AGENTD_UPDATE_NOTIFICATIONS_MARK_SEEN_METHOD =
	"octofwen.agentd/updateNotificationsMarkSeen";
export const AGENTD_CONVERSATION_HISTORY_APPEND_METHOD =
	"octofwen.agentd/conversationHistoryAppend";
export const AGENTD_CONVERSATION_HISTORY_RECORDS_METHOD =
	"octofwen.agentd/conversationHistoryRecords";
export const AGENTD_CONVERSATION_HISTORY_LLM_PAYLOADS_METHOD =
	"octofwen.agentd/conversationHistoryLlmPayloads";
export const AGENTD_TRAJECTORY_ARC_METHOD = "octofwen.agentd/trajectoryArc";
export const AGENTD_TRAJECTORY_FINISH_METHOD =
	"octofwen.agentd/trajectoryFinish";
export const AGENTD_SYSTEM_PROMPT_METHOD = "octofwen.agentd/systemPrompt";
export const AGENTD_COMPACTION_DECISION_METHOD =
	"octofwen.agentd/compactionDecision";
export const AGENTD_COMPACTION_PREPARE_METHOD =
	"octofwen.agentd/compactionPrepare";
export const AGENTD_COMPACTION_CHECKPOINT_CONTENT_METHOD =
	"octofwen.agentd/compactionCheckpointContent";
export const AGENTD_CONFIG_MIGRATE_METHOD = "octofwen.agentd/configMigrate";
export const AGENTD_CONFIG_SANITIZE_METHOD = "octofwen.agentd/configSanitize";
export const AGENTD_CONFIG_KEY_FOR_MODEL_METHOD =
	"octofwen.agentd/configKeyForModel";
export const AGENTD_CONFIG_KEY_FOR_BASE_URL_METHOD =
	"octofwen.agentd/configKeyForBaseUrl";
export const AGENTD_CONFIG_SEARCH_METHOD = "octofwen.agentd/configSearch";
export const AGENTD_CONFIG_HAS_EXISTING_KEY_METHOD =
	"octofwen.agentd/configHasExistingKey";
export const AGENTD_CONFIG_WRITE_KEY_METHOD = "octofwen.agentd/configWriteKey";
export const AGENTD_AUTOFIX_JSON_METHOD = "octofwen.agentd/autofixJson";
export const AGENTD_AUTOFIX_EDIT_METHOD = "octofwen.agentd/autofixEdit";
export const AGENTD_OCTO_LOWER_METHOD = "octofwen.agentd/octoLower";
export const AGENTD_RENDER_TOOL_CALL_METHOD = "octofwen.agentd/renderToolCall";
export const AGENTD_TOOL_DEFINITIONS_METHOD = "octofwen.agentd/toolDefinitions";
export const AGENTD_TOOL_RUN_METHOD = "octofwen.agentd/toolRun";
export const AGENTD_TOOL_PERMISSION_METHOD = "octofwen.agentd/toolPermission";
export const AGENTD_TOOL_VALIDATE_METHOD = "octofwen.agentd/toolValidate";
export const AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD =
	"octofwen.agentd/providerCompilerComplete";
export const AGENTD_MODEL_PROVIDER_CATALOG_METHOD =
	"octofwen.agentd/modelProviderCatalog";
export const AGENTD_MODEL_CONNECTION_TEST_METHOD =
	"octofwen.agentd/modelConnectionTest";
export const AGENTD_SYNTHETIC_QUOTA_FETCH_METHOD =
	"octofwen.agentd/syntheticQuotaFetch";
export const AGENTD_SKILL_DISCOVER_METHOD = "octofwen.agentd/skillDiscover";

export type {
	AgentdConversationHistoryAppendParams,
	AgentdConversationHistoryAppendResult,
	AgentdConversationHistoryEntry,
	AgentdConversationHistoryKind,
	AgentdConversationHistoryLlmPayloadsResult,
	AgentdConversationHistoryParams,
	AgentdConversationHistoryRecord,
	AgentdConversationHistoryRecordsResult,
} from "./conversation-history.ts";

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
};

function validateAgentdResult<T>(
	result: unknown,
	isExpected: (value: unknown) => value is T,
	invalidResponseError: () => Error,
): Result<T, Error> {
	return isExpected(result) ? ok(result) : err(invalidResponseError());
}

function unwrapAgentdResult<T>(
	validation: Result<T, Error>,
): T | Promise<never> {
	if (!validation.success) return Promise.reject(validation.error);
	return validation.data;
}

export class AgentdRustBridge {
	readonly #client: AgentdClientLike;

	constructor(client: AgentdClientLike) {
		this.#client = client;
	}

	async inputHistoryLoad(
		params: AgentdInputHistoryLoadParams = {},
	): Promise<AgentdInputHistoryResult> {
		const result = await this.#client.request(
			AGENTD_INPUT_HISTORY_LOAD_METHOD,
			params,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdInputHistoryResult,
				invalidAgentdInputHistoryResponseError,
			),
		);
	}

	async inputHistoryAppend(
		params: AgentdInputHistoryAppendParams,
	): Promise<AgentdInputHistoryResult> {
		const result = await this.#client.request(
			AGENTD_INPUT_HISTORY_APPEND_METHOD,
			params,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdInputHistoryResult,
				invalidAgentdInputHistoryResponseError,
			),
		);
	}

	async conversationHistoryAppend(
		params: AgentdConversationHistoryAppendParams,
	): Promise<AgentdConversationHistoryAppendResult> {
		const result = await this.#client.request(
			AGENTD_CONVERSATION_HISTORY_APPEND_METHOD,
			params,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdConversationHistoryAppendResult,
				invalidAgentdConversationHistoryAppendResponseError,
			),
		);
	}

	async conversationHistoryRecords(
		params: AgentdConversationHistoryParams = {},
	): Promise<AgentdConversationHistoryRecordsResult> {
		const result = await this.#client.request(
			AGENTD_CONVERSATION_HISTORY_RECORDS_METHOD,
			params,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdConversationHistoryRecordsResult,
				invalidAgentdConversationHistoryRecordsResponseError,
			),
		);
	}

	async conversationHistoryLlmPayloads(
		params: AgentdConversationHistoryParams = {},
	): Promise<AgentdConversationHistoryLlmPayloadsResult> {
		const result = await this.#client.request(
			AGENTD_CONVERSATION_HISTORY_LLM_PAYLOADS_METHOD,
			params,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdConversationHistoryLlmPayloadsResult,
				invalidAgentdConversationHistoryLlmPayloadsResponseError,
			),
		);
	}

	async updateNotificationsRead(
		params: AgentdUpdateNotificationsParams = {},
	): Promise<AgentdUpdateNotificationsReadResult> {
		const result = await this.#client.request(
			AGENTD_UPDATE_NOTIFICATIONS_READ_METHOD,
			params,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdUpdateNotificationsReadResult,
				invalidAgentdUpdateNotificationsReadResponseError,
			),
		);
	}

	async updateNotificationsMarkSeen(
		params: AgentdUpdateNotificationsParams = {},
	): Promise<AgentdUpdateNotificationsMarkSeenResult> {
		const result = await this.#client.request(
			AGENTD_UPDATE_NOTIFICATIONS_MARK_SEEN_METHOD,
			params,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdUpdateNotificationsMarkSeenResult,
				invalidAgentdUpdateNotificationsMarkSeenResponseError,
			),
		);
	}

	async trajectoryArc(
		params: AgentdTrajectoryArcParams,
		options: AgentdRequestOptions = {},
	): Promise<AgentdTrajectoryArcResult> {
		const result = await this.#client.request(
			AGENTD_TRAJECTORY_ARC_METHOD,
			params,
			options,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdTrajectoryArcResult,
				invalidAgentdTrajectoryArcResponseError,
			),
		);
	}

	async trajectoryFinish(
		params: AgentdTrajectoryFinishParams,
	): Promise<AgentdTrajectoryFinishResult> {
		const result = await this.#client.request(
			AGENTD_TRAJECTORY_FINISH_METHOD,
			params,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdTrajectoryFinishResult,
				invalidAgentdTrajectoryFinishResponseError,
			),
		);
	}

	async systemPrompt(
		params: AgentdSystemPromptParams,
	): Promise<AgentdSystemPromptResult> {
		const result = await this.#client.request(
			AGENTD_SYSTEM_PROMPT_METHOD,
			params,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdSystemPromptResult,
				invalidAgentdSystemPromptResponseError,
			),
		);
	}

	async compactionDecision(
		params: AgentdCompactionDecisionParams,
	): Promise<AgentdCompactionDecisionResult> {
		const result = await this.#client.request(
			AGENTD_COMPACTION_DECISION_METHOD,
			params,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdCompactionDecisionResult,
				invalidAgentdCompactionDecisionResponseError,
			),
		);
	}

	async compactionPrepare(
		params: AgentdCompactionPrepareParams,
	): Promise<AgentdCompactionPrepareResult> {
		const result = await this.#client.request(
			AGENTD_COMPACTION_PREPARE_METHOD,
			params,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdCompactionPrepareResult,
				invalidAgentdCompactionPrepareResponseError,
			),
		);
	}

	async compactionCheckpointContent(
		params: AgentdCompactionCheckpointContentParams,
	): Promise<AgentdCompactionCheckpointContentResult> {
		const result = await this.#client.request(
			AGENTD_COMPACTION_CHECKPOINT_CONTENT_METHOD,
			params,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdCompactionCheckpointContentResult,
				invalidAgentdCompactionCheckpointContentResponseError,
			),
		);
	}

	async autofixJson(
		params: AgentdAutofixJsonParams,
	): Promise<AgentdAutofixJsonResult> {
		const result = await this.#client.request(
			AGENTD_AUTOFIX_JSON_METHOD,
			params,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdAutofixJsonResult,
				invalidAgentdAutofixJsonResponseError,
			),
		);
	}

	async autofixEdit(
		params: AgentdAutofixEditParams,
	): Promise<AgentdAutofixEditResult> {
		const result = await this.#client.request(
			AGENTD_AUTOFIX_EDIT_METHOD,
			params,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdAutofixEditResult,
				invalidAgentdAutofixEditResponseError,
			),
		);
	}

	async octoLower(
		params: AgentdOctoLowerParams,
	): Promise<AgentdOctoLowerResult> {
		const result = await this.#client.request(AGENTD_OCTO_LOWER_METHOD, params);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdOctoLowerResult,
				invalidAgentdOctoLowerResponseError,
			),
		);
	}

	async initialize(): Promise<AgentdInitializeResult> {
		const result = await this.#client.request(AGENTD_INITIALIZE_METHOD);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdInitializeResult,
				invalidAgentdInitializeResponseError,
			),
		);
	}

	async renderToolCall(
		name: string,
		args: Record<string, unknown>,
	): Promise<AgentdToolRenderModel> {
		const result = await this.#client.request(AGENTD_RENDER_TOOL_CALL_METHOD, {
			name,
			arguments: args,
		});
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdToolRenderModel,
				invalidAgentdToolRenderResponseError,
			),
		);
	}

	async toolDefinitions(
		params: AgentdToolDefinitionsParams,
	): Promise<AgentdToolDefinitionsResult> {
		const result = await this.#client.request(
			AGENTD_TOOL_DEFINITIONS_METHOD,
			params,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdToolDefinitionsResult,
				invalidAgentdToolDefinitionsResponseError,
			),
		);
	}

	async toolRun(
		params: AgentdToolRunParams,
		options: AgentdRequestOptions = {},
	): Promise<AgentdToolRunResult> {
		const result = await this.#client.request(
			AGENTD_TOOL_RUN_METHOD,
			params,
			options,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdToolRunResult,
				invalidAgentdToolRunResponseError,
			),
		);
	}

	async toolPermission(
		params: AgentdToolPermissionParams,
	): Promise<AgentdToolPermissionResult> {
		const result = await this.#client.request(
			AGENTD_TOOL_PERMISSION_METHOD,
			params,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdToolPermissionResult,
				invalidAgentdToolPermissionResponseError,
			),
		);
	}

	async skillDiscover(
		params: AgentdSkillDiscoverParams,
	): Promise<AgentdSkillDiscoverResult> {
		const result = await this.#client.request(
			AGENTD_SKILL_DISCOVER_METHOD,
			params,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdSkillDiscoverResult,
				invalidAgentdSkillDiscoverResponseError,
			),
		);
	}

	async toolValidate(
		params: AgentdToolValidateParams,
		options: AgentdRequestOptions = {},
	): Promise<AgentdToolValidateResult> {
		const result = await this.#client.request(
			AGENTD_TOOL_VALIDATE_METHOD,
			params,
			options,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdToolValidateResult,
				invalidAgentdToolValidateResponseError,
			),
		);
	}

	async providerCompilerComplete(
		params: AgentdProviderCompilerCompleteParams,
		options: AgentdRequestOptions = {},
	): Promise<AgentdProviderCompilerCompleteResult> {
		const result = await this.#client.request(
			AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD,
			params,
			options,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdProviderCompilerCompleteResult,
				invalidAgentdProviderCompilerCompleteResponseError,
			),
		);
	}

	async modelProviderCatalog(): Promise<AgentdModelProviderCatalogResult> {
		const result = await this.#client.request(
			AGENTD_MODEL_PROVIDER_CATALOG_METHOD,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdModelProviderCatalogResult,
				invalidAgentdModelProviderCatalogResponseError,
			),
		);
	}

	async configMigrate(params: AgentdConfigParams): Promise<AgentdConfigResult> {
		const result = await this.#client.request(
			AGENTD_CONFIG_MIGRATE_METHOD,
			params,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdConfigResult,
				invalidAgentdConfigResponseError,
			),
		);
	}

	async configSanitize(
		params: AgentdConfigParams,
	): Promise<AgentdConfigResult> {
		const result = await this.#client.request(
			AGENTD_CONFIG_SANITIZE_METHOD,
			params,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdConfigResult,
				invalidAgentdConfigResponseError,
			),
		);
	}

	async configKeyForModel(
		params: AgentdConfigKeyForModelParams,
	): Promise<AgentdConfigKeyResultEnvelope> {
		const result = await this.#client.request(
			AGENTD_CONFIG_KEY_FOR_MODEL_METHOD,
			params,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdConfigKeyResultEnvelope,
				invalidAgentdConfigResponseError,
			),
		);
	}

	async configKeyForBaseUrl(
		params: AgentdConfigKeyForBaseUrlParams,
	): Promise<AgentdConfigKeyResultEnvelope> {
		const result = await this.#client.request(
			AGENTD_CONFIG_KEY_FOR_BASE_URL_METHOD,
			params,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdConfigKeyResultEnvelope,
				invalidAgentdConfigResponseError,
			),
		);
	}

	async configSearch(
		params: AgentdConfigSearchParams,
	): Promise<AgentdConfigSearchResult> {
		const result = await this.#client.request(
			AGENTD_CONFIG_SEARCH_METHOD,
			params,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdConfigSearchResult,
				invalidAgentdConfigResponseError,
			),
		);
	}

	async configHasExistingKey(
		params: AgentdConfigKeyForBaseUrlParams,
	): Promise<AgentdConfigHasExistingKeyResult> {
		const result = await this.#client.request(
			AGENTD_CONFIG_HAS_EXISTING_KEY_METHOD,
			params,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdConfigHasExistingKeyResult,
				invalidAgentdConfigResponseError,
			),
		);
	}

	async configWriteKey(
		params: AgentdConfigWriteKeyParams,
	): Promise<AgentdConfigWriteKeyResult> {
		const result = await this.#client.request(
			AGENTD_CONFIG_WRITE_KEY_METHOD,
			params,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdConfigWriteKeyResult,
				invalidAgentdConfigResponseError,
			),
		);
	}

	async modelConnectionTest(
		params: AgentdModelConnectionTestParams,
	): Promise<AgentdModelConnectionTestResult> {
		const result = await this.#client.request(
			AGENTD_MODEL_CONNECTION_TEST_METHOD,
			params,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdModelConnectionTestResult,
				invalidAgentdModelConnectionTestResponseError,
			),
		);
	}

	async syntheticQuotaFetch(
		params: AgentdSyntheticQuotaFetchParams,
	): Promise<AgentdSyntheticQuotaFetchResult> {
		const result = await this.#client.request(
			AGENTD_SYNTHETIC_QUOTA_FETCH_METHOD,
			params,
		);
		return unwrapAgentdResult(
			validateAgentdResult(
				result,
				isAgentdSyntheticQuotaFetchResult,
				invalidAgentdSyntheticQuotaFetchResponseError,
			),
		);
	}

	close(): void {
		this.#client.close();
	}
}

export function spawnAgentdProcessClient(
	options: AgentdSpawnOptions = {},
): AgentdProcessClient {
	return new AgentdProcessClient(spawnAgentdProcess(options));
}

export async function createAgentdRustBridge(
	options: CreateAgentdRustBridgeOptions = {},
): Promise<AgentdRustBridge> {
	const client = options.createClient?.() ?? spawnAgentdProcessClient(options);
	const bridge = new AgentdRustBridge(client);
	await bridge.initialize();
	return bridge;
}
