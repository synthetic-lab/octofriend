import type { AgentdRequestOptions } from "../ipc/client";
import * as agentMethods from "./methods";
import {
	type AgentdRequestClient,
	requestAgentdResult,
} from "./agent-check";
import {
	type AgentdAutofixEditParams,
	type AgentdAutofixEditResult,
	type AgentdAutofixJsonParams,
	type AgentdAutofixJsonResult,
	isAgentdAutofixEditResult,
	isAgentdAutofixJsonResult,
} from "./autofix";
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
} from "./compaction";
import {
	invalidAgentdAutofixEditResponseError,
	invalidAgentdAutofixJsonResponseError,
	invalidAgentdCompactionCheckpointContentResponseError,
	invalidAgentdCompactionDecisionResponseError,
	invalidAgentdCompactionPrepareResponseError,
	invalidAgentdInitializeResponseError,
	invalidAgentdModelConnectionTestResponseError,
	invalidAgentdModelProviderCatalogResponseError,
	invalidAgentdOctoLowerResponseError,
	invalidAgentdProviderCompilerCompleteResponseError,
	invalidAgentdSyntheticQuotaFetchResponseError,
	invalidAgentdSystemPromptResponseError,
	invalidAgentdTrajectoryArcResponseError,
	invalidAgentdTrajectoryFinishResponseError,
} from "./errors";
import {
	type AgentdInitializeResult,
	isAgentdInitializeResult,
} from "./initialize";
import {
	type AgentdModelProviderCatalogResult,
	isAgentdModelProviderCatalogResult,
} from "./catalog";
import {
	type AgentdModelConnectionTestParams,
	type AgentdModelConnectionTestResult,
	isAgentdModelConnectionTestResult,
} from "./connection";
import {
	type AgentdOctoLowerParams,
	type AgentdOctoLowerResult,
	isAgentdOctoLowerResult,
} from "./octofriend";
import {
	type AgentdProviderCompilerCompleteParams,
	type AgentdProviderCompilerCompleteResult,
	isAgentdProviderCompilerCompleteResult,
} from "./provider";
import {
	type AgentdSyntheticQuotaFetchParams,
	type AgentdSyntheticQuotaFetchResult,
	isAgentdSyntheticQuotaFetchResult,
} from "./synthetic-quota";
import {
	type AgentdSystemPromptParams,
	type AgentdSystemPromptResult,
	isAgentdSystemPromptResult,
} from "./system-prompt";
import {
	type AgentdTrajectoryArcParams,
	type AgentdTrajectoryArcResult,
	isAgentdTrajectoryArcResult,
} from "./run-arc";
import {
	type AgentdTrajectoryFinishParams,
	type AgentdTrajectoryFinishResult,
	isAgentdTrajectoryFinishResult,
} from "./run-finish";

export async function trajectoryArc(
	client: AgentdRequestClient,
	params: AgentdTrajectoryArcParams,
	options: AgentdRequestOptions,
): Promise<AgentdTrajectoryArcResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_TRAJECTORY_ARC_METHOD,
		params,
		isAgentdTrajectoryArcResult,
		invalidAgentdTrajectoryArcResponseError,
		options,
	);
}

export async function trajectoryFinish(
	client: AgentdRequestClient,
	params: AgentdTrajectoryFinishParams,
): Promise<AgentdTrajectoryFinishResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_TRAJECTORY_FINISH_METHOD,
		params,
		isAgentdTrajectoryFinishResult,
		invalidAgentdTrajectoryFinishResponseError,
	);
}

export async function systemPrompt(
	client: AgentdRequestClient,
	params: AgentdSystemPromptParams,
): Promise<AgentdSystemPromptResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_SYSTEM_PROMPT_METHOD,
		params,
		isAgentdSystemPromptResult,
		invalidAgentdSystemPromptResponseError,
	);
}

export async function compactionDecision(
	client: AgentdRequestClient,
	params: AgentdCompactionDecisionParams,
): Promise<AgentdCompactionDecisionResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_COMPACTION_DECISION_METHOD,
		params,
		isAgentdCompactionDecisionResult,
		invalidAgentdCompactionDecisionResponseError,
	);
}

export async function compactionPrepare(
	client: AgentdRequestClient,
	params: AgentdCompactionPrepareParams,
): Promise<AgentdCompactionPrepareResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_COMPACTION_PREPARE_METHOD,
		params,
		isAgentdCompactionPrepareResult,
		invalidAgentdCompactionPrepareResponseError,
	);
}

export async function compactionCheckpointContent(
	client: AgentdRequestClient,
	params: AgentdCompactionCheckpointContentParams,
): Promise<AgentdCompactionCheckpointContentResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_COMPACTION_CHECKPOINT_CONTENT_METHOD,
		params,
		isAgentdCompactionCheckpointContentResult,
		invalidAgentdCompactionCheckpointContentResponseError,
	);
}

export async function autofixJson(
	client: AgentdRequestClient,
	params: AgentdAutofixJsonParams,
): Promise<AgentdAutofixJsonResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_AUTOFIX_JSON_METHOD,
		params,
		isAgentdAutofixJsonResult,
		invalidAgentdAutofixJsonResponseError,
	);
}

export async function autofixEdit(
	client: AgentdRequestClient,
	params: AgentdAutofixEditParams,
): Promise<AgentdAutofixEditResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_AUTOFIX_EDIT_METHOD,
		params,
		isAgentdAutofixEditResult,
		invalidAgentdAutofixEditResponseError,
	);
}

export async function octoLower(
	client: AgentdRequestClient,
	params: AgentdOctoLowerParams,
): Promise<AgentdOctoLowerResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_OCTO_LOWER_METHOD,
		params,
		isAgentdOctoLowerResult,
		invalidAgentdOctoLowerResponseError,
	);
}

export async function initialize(
	client: AgentdRequestClient,
): Promise<AgentdInitializeResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_INITIALIZE_METHOD,
		undefined,
		isAgentdInitializeResult,
		invalidAgentdInitializeResponseError,
	);
}

export async function providerCompilerComplete(
	client: AgentdRequestClient,
	params: AgentdProviderCompilerCompleteParams,
	options: AgentdRequestOptions,
): Promise<AgentdProviderCompilerCompleteResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD,
		params,
		isAgentdProviderCompilerCompleteResult,
		invalidAgentdProviderCompilerCompleteResponseError,
		options,
	);
}

export async function modelProviderCatalog(
	client: AgentdRequestClient,
): Promise<AgentdModelProviderCatalogResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_MODEL_PROVIDER_CATALOG_METHOD,
		undefined,
		isAgentdModelProviderCatalogResult,
		invalidAgentdModelProviderCatalogResponseError,
	);
}

export async function modelConnectionTest(
	client: AgentdRequestClient,
	params: AgentdModelConnectionTestParams,
): Promise<AgentdModelConnectionTestResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_MODEL_CONNECTION_TEST_METHOD,
		params,
		isAgentdModelConnectionTestResult,
		invalidAgentdModelConnectionTestResponseError,
	);
}

export async function syntheticQuotaFetch(
	client: AgentdRequestClient,
	params: AgentdSyntheticQuotaFetchParams,
): Promise<AgentdSyntheticQuotaFetchResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_SYNTHETIC_QUOTA_FETCH_METHOD,
		params,
		isAgentdSyntheticQuotaFetchResult,
		invalidAgentdSyntheticQuotaFetchResponseError,
	);
}
