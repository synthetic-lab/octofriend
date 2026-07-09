import type { AgentdRequestOptions } from "../ipc/client";
import * as agentMethods from "./methods";
import {
	type AgentdRequestClient,
	requestAgentdResult,
} from "./agent-check";
import {
	invalidAgentdSkillDiscoverResponseError,
	invalidAgentdToolDefinitionsResponseError,
	invalidAgentdToolPermissionResponseError,
	invalidAgentdToolRenderResponseError,
	invalidAgentdToolRunResponseError,
	invalidAgentdToolValidateResponseError,
} from "./errors";
import {
	type AgentdSkillDiscoverParams,
	type AgentdSkillDiscoverResult,
	isAgentdSkillDiscoverResult,
} from "./skills";
import {
	type AgentdToolDefinitionsParams,
	type AgentdToolDefinitionsResult,
	isAgentdToolDefinitionsResult,
} from "./tool-defs";
import {
	type AgentdToolPermissionParams,
	type AgentdToolPermissionResult,
	isAgentdToolPermissionResult,
} from "./tool-permission";
import {
	type AgentdToolRenderModel,
	isAgentdToolRenderModel,
} from "./tool-render";
import {
	type AgentdToolRunParams,
	type AgentdToolRunResult,
	isAgentdToolRunResult,
} from "./tool-run";
import {
	type AgentdToolValidateParams,
	type AgentdToolValidateResult,
	isAgentdToolValidateResult,
} from "./tool-check";

export async function renderToolCall(
	client: AgentdRequestClient,
	name: string,
	args: Record<string, unknown>,
): Promise<AgentdToolRenderModel> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_RENDER_TOOL_CALL_METHOD,
		{ name, arguments: args },
		isAgentdToolRenderModel,
		invalidAgentdToolRenderResponseError,
	);
}

export async function toolDefinitions(
	client: AgentdRequestClient,
	params: AgentdToolDefinitionsParams,
): Promise<AgentdToolDefinitionsResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_TOOL_DEFINITIONS_METHOD,
		params,
		isAgentdToolDefinitionsResult,
		invalidAgentdToolDefinitionsResponseError,
	);
}

export async function toolRun(
	client: AgentdRequestClient,
	params: AgentdToolRunParams,
	options: AgentdRequestOptions,
): Promise<AgentdToolRunResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_TOOL_RUN_METHOD,
		params,
		isAgentdToolRunResult,
		invalidAgentdToolRunResponseError,
		options,
	);
}

export async function toolPermission(
	client: AgentdRequestClient,
	params: AgentdToolPermissionParams,
): Promise<AgentdToolPermissionResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_TOOL_PERMISSION_METHOD,
		params,
		isAgentdToolPermissionResult,
		invalidAgentdToolPermissionResponseError,
	);
}

export async function skillDiscover(
	client: AgentdRequestClient,
	params: AgentdSkillDiscoverParams,
): Promise<AgentdSkillDiscoverResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_SKILL_DISCOVER_METHOD,
		params,
		isAgentdSkillDiscoverResult,
		invalidAgentdSkillDiscoverResponseError,
	);
}

export async function toolValidate(
	client: AgentdRequestClient,
	params: AgentdToolValidateParams,
	options: AgentdRequestOptions,
): Promise<AgentdToolValidateResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_TOOL_VALIDATE_METHOD,
		params,
		isAgentdToolValidateResult,
		invalidAgentdToolValidateResponseError,
		options,
	);
}
