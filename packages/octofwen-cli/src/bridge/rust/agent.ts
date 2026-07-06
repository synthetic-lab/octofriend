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
		if (!isAgentdInputHistoryResult(result)) {
			throw invalidAgentdInputHistoryResponseError();
		}
		return result;
	}

	async inputHistoryAppend(
		params: AgentdInputHistoryAppendParams,
	): Promise<AgentdInputHistoryResult> {
		const result = await this.#client.request(
			AGENTD_INPUT_HISTORY_APPEND_METHOD,
			params,
		);
		if (!isAgentdInputHistoryResult(result)) {
			throw invalidAgentdInputHistoryResponseError();
		}
		return result;
	}

	async conversationHistoryAppend(
		params: AgentdConversationHistoryAppendParams,
	): Promise<AgentdConversationHistoryAppendResult> {
		const result = await this.#client.request(
			AGENTD_CONVERSATION_HISTORY_APPEND_METHOD,
			params,
		);
		if (!isAgentdConversationHistoryAppendResult(result)) {
			throw invalidAgentdConversationHistoryAppendResponseError();
		}
		return result;
	}

	async conversationHistoryRecords(
		params: AgentdConversationHistoryParams = {},
	): Promise<AgentdConversationHistoryRecordsResult> {
		const result = await this.#client.request(
			AGENTD_CONVERSATION_HISTORY_RECORDS_METHOD,
			params,
		);
		if (!isAgentdConversationHistoryRecordsResult(result)) {
			throw invalidAgentdConversationHistoryRecordsResponseError();
		}
		return result;
	}

	async conversationHistoryLlmPayloads(
		params: AgentdConversationHistoryParams = {},
	): Promise<AgentdConversationHistoryLlmPayloadsResult> {
		const result = await this.#client.request(
			AGENTD_CONVERSATION_HISTORY_LLM_PAYLOADS_METHOD,
			params,
		);
		if (!isAgentdConversationHistoryLlmPayloadsResult(result)) {
			throw invalidAgentdConversationHistoryLlmPayloadsResponseError();
		}
		return result;
	}

	async updateNotificationsRead(
		params: AgentdUpdateNotificationsParams = {},
	): Promise<AgentdUpdateNotificationsReadResult> {
		const result = await this.#client.request(
			AGENTD_UPDATE_NOTIFICATIONS_READ_METHOD,
			params,
		);
		if (!isAgentdUpdateNotificationsReadResult(result)) {
			throw invalidAgentdUpdateNotificationsReadResponseError();
		}
		return result;
	}

	async updateNotificationsMarkSeen(
		params: AgentdUpdateNotificationsParams = {},
	): Promise<AgentdUpdateNotificationsMarkSeenResult> {
		const result = await this.#client.request(
			AGENTD_UPDATE_NOTIFICATIONS_MARK_SEEN_METHOD,
			params,
		);
		if (!isAgentdUpdateNotificationsMarkSeenResult(result)) {
			throw invalidAgentdUpdateNotificationsMarkSeenResponseError();
		}
		return result;
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
		if (!isAgentdTrajectoryArcResult(result)) {
			throw invalidAgentdTrajectoryArcResponseError();
		}
		return result;
	}

	async trajectoryFinish(
		params: AgentdTrajectoryFinishParams,
	): Promise<AgentdTrajectoryFinishResult> {
		const result = await this.#client.request(
			AGENTD_TRAJECTORY_FINISH_METHOD,
			params,
		);
		if (!isAgentdTrajectoryFinishResult(result)) {
			throw invalidAgentdTrajectoryFinishResponseError();
		}
		return result;
	}

	async systemPrompt(
		params: AgentdSystemPromptParams,
	): Promise<AgentdSystemPromptResult> {
		const result = await this.#client.request(
			AGENTD_SYSTEM_PROMPT_METHOD,
			params,
		);
		if (!isAgentdSystemPromptResult(result)) {
			throw invalidAgentdSystemPromptResponseError();
		}
		return result;
	}

	async compactionDecision(
		params: AgentdCompactionDecisionParams,
	): Promise<AgentdCompactionDecisionResult> {
		const result = await this.#client.request(
			AGENTD_COMPACTION_DECISION_METHOD,
			params,
		);
		if (!isAgentdCompactionDecisionResult(result)) {
			throw invalidAgentdCompactionDecisionResponseError();
		}
		return result;
	}

	async compactionPrepare(
		params: AgentdCompactionPrepareParams,
	): Promise<AgentdCompactionPrepareResult> {
		const result = await this.#client.request(
			AGENTD_COMPACTION_PREPARE_METHOD,
			params,
		);
		if (!isAgentdCompactionPrepareResult(result)) {
			throw invalidAgentdCompactionPrepareResponseError();
		}
		return result;
	}

	async compactionCheckpointContent(
		params: AgentdCompactionCheckpointContentParams,
	): Promise<AgentdCompactionCheckpointContentResult> {
		const result = await this.#client.request(
			AGENTD_COMPACTION_CHECKPOINT_CONTENT_METHOD,
			params,
		);
		if (!isAgentdCompactionCheckpointContentResult(result)) {
			throw invalidAgentdCompactionCheckpointContentResponseError();
		}
		return result;
	}

	async autofixJson(
		params: AgentdAutofixJsonParams,
	): Promise<AgentdAutofixJsonResult> {
		const result = await this.#client.request(
			AGENTD_AUTOFIX_JSON_METHOD,
			params,
		);
		if (!isAgentdAutofixJsonResult(result)) {
			throw invalidAgentdAutofixJsonResponseError();
		}
		return result;
	}

	async autofixEdit(
		params: AgentdAutofixEditParams,
	): Promise<AgentdAutofixEditResult> {
		const result = await this.#client.request(
			AGENTD_AUTOFIX_EDIT_METHOD,
			params,
		);
		if (!isAgentdAutofixEditResult(result)) {
			throw invalidAgentdAutofixEditResponseError();
		}
		return result;
	}

	async octoLower(
		params: AgentdOctoLowerParams,
	): Promise<AgentdOctoLowerResult> {
		const result = await this.#client.request(AGENTD_OCTO_LOWER_METHOD, params);
		if (!isAgentdOctoLowerResult(result)) {
			throw invalidAgentdOctoLowerResponseError();
		}
		return result;
	}

	async initialize(): Promise<AgentdInitializeResult> {
		const result = await this.#client.request(AGENTD_INITIALIZE_METHOD);
		if (!isAgentdInitializeResult(result)) {
			throw invalidAgentdInitializeResponseError();
		}
		return result;
	}

	async renderToolCall(
		name: string,
		args: Record<string, unknown>,
	): Promise<AgentdToolRenderModel> {
		const result = await this.#client.request(AGENTD_RENDER_TOOL_CALL_METHOD, {
			name,
			arguments: args,
		});
		if (!isAgentdToolRenderModel(result)) {
			throw invalidAgentdToolRenderResponseError();
		}
		return result;
	}

	async toolDefinitions(
		params: AgentdToolDefinitionsParams,
	): Promise<AgentdToolDefinitionsResult> {
		const result = await this.#client.request(
			AGENTD_TOOL_DEFINITIONS_METHOD,
			params,
		);
		if (!isAgentdToolDefinitionsResult(result)) {
			throw invalidAgentdToolDefinitionsResponseError();
		}
		return result;
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
		if (!isAgentdToolRunResult(result)) {
			throw invalidAgentdToolRunResponseError();
		}
		return result;
	}

	async toolPermission(
		params: AgentdToolPermissionParams,
	): Promise<AgentdToolPermissionResult> {
		const result = await this.#client.request(
			AGENTD_TOOL_PERMISSION_METHOD,
			params,
		);
		if (!isAgentdToolPermissionResult(result)) {
			throw invalidAgentdToolPermissionResponseError();
		}
		return result;
	}

	async skillDiscover(
		params: AgentdSkillDiscoverParams,
	): Promise<AgentdSkillDiscoverResult> {
		const result = await this.#client.request(
			AGENTD_SKILL_DISCOVER_METHOD,
			params,
		);
		if (!isAgentdSkillDiscoverResult(result)) {
			throw invalidAgentdSkillDiscoverResponseError();
		}
		return result;
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
		if (!isAgentdToolValidateResult(result)) {
			throw invalidAgentdToolValidateResponseError();
		}
		return result;
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
		if (!isAgentdProviderCompilerCompleteResult(result)) {
			throw invalidAgentdProviderCompilerCompleteResponseError();
		}
		return result;
	}

	async modelProviderCatalog(): Promise<AgentdModelProviderCatalogResult> {
		const result = await this.#client.request(
			AGENTD_MODEL_PROVIDER_CATALOG_METHOD,
		);
		if (!isAgentdModelProviderCatalogResult(result)) {
			throw invalidAgentdModelProviderCatalogResponseError();
		}
		return result;
	}

	async configMigrate(params: AgentdConfigParams): Promise<AgentdConfigResult> {
		const result = await this.#client.request(
			AGENTD_CONFIG_MIGRATE_METHOD,
			params,
		);
		if (!isAgentdConfigResult(result)) {
			throw invalidAgentdConfigResponseError();
		}
		return result;
	}

	async configSanitize(
		params: AgentdConfigParams,
	): Promise<AgentdConfigResult> {
		const result = await this.#client.request(
			AGENTD_CONFIG_SANITIZE_METHOD,
			params,
		);
		if (!isAgentdConfigResult(result)) {
			throw invalidAgentdConfigResponseError();
		}
		return result;
	}

	async configKeyForModel(
		params: AgentdConfigKeyForModelParams,
	): Promise<AgentdConfigKeyResultEnvelope> {
		const result = await this.#client.request(
			AGENTD_CONFIG_KEY_FOR_MODEL_METHOD,
			params,
		);
		if (!isAgentdConfigKeyResultEnvelope(result)) {
			throw invalidAgentdConfigResponseError();
		}
		return result;
	}

	async configKeyForBaseUrl(
		params: AgentdConfigKeyForBaseUrlParams,
	): Promise<AgentdConfigKeyResultEnvelope> {
		const result = await this.#client.request(
			AGENTD_CONFIG_KEY_FOR_BASE_URL_METHOD,
			params,
		);
		if (!isAgentdConfigKeyResultEnvelope(result)) {
			throw invalidAgentdConfigResponseError();
		}
		return result;
	}

	async configSearch(
		params: AgentdConfigSearchParams,
	): Promise<AgentdConfigSearchResult> {
		const result = await this.#client.request(
			AGENTD_CONFIG_SEARCH_METHOD,
			params,
		);
		if (!isAgentdConfigSearchResult(result)) {
			throw invalidAgentdConfigResponseError();
		}
		return result;
	}

	async configHasExistingKey(
		params: AgentdConfigKeyForBaseUrlParams,
	): Promise<AgentdConfigHasExistingKeyResult> {
		const result = await this.#client.request(
			AGENTD_CONFIG_HAS_EXISTING_KEY_METHOD,
			params,
		);
		if (!isAgentdConfigHasExistingKeyResult(result)) {
			throw invalidAgentdConfigResponseError();
		}
		return result;
	}

	async configWriteKey(
		params: AgentdConfigWriteKeyParams,
	): Promise<AgentdConfigWriteKeyResult> {
		const result = await this.#client.request(
			AGENTD_CONFIG_WRITE_KEY_METHOD,
			params,
		);
		if (!isAgentdConfigWriteKeyResult(result)) {
			throw invalidAgentdConfigResponseError();
		}
		return result;
	}

	async modelConnectionTest(
		params: AgentdModelConnectionTestParams,
	): Promise<AgentdModelConnectionTestResult> {
		const result = await this.#client.request(
			AGENTD_MODEL_CONNECTION_TEST_METHOD,
			params,
		);
		if (!isAgentdModelConnectionTestResult(result)) {
			throw invalidAgentdModelConnectionTestResponseError();
		}
		return result;
	}

	async syntheticQuotaFetch(
		params: AgentdSyntheticQuotaFetchParams,
	): Promise<AgentdSyntheticQuotaFetchResult> {
		const result = await this.#client.request(
			AGENTD_SYNTHETIC_QUOTA_FETCH_METHOD,
			params,
		);
		if (!isAgentdSyntheticQuotaFetchResult(result)) {
			throw invalidAgentdSyntheticQuotaFetchResponseError();
		}
		return result;
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
