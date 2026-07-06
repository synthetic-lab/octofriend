import { homedir } from "node:os";

import { err, errorToString, ok, type Result } from "../../app/result.ts";
import type { ImageInfo } from "../../input/image_attachments.ts";
import { readSearchConfig } from "../configuration/keys.ts";
import { getModelFromConfig } from "../configuration/model-selection.ts";
import type { Config } from "../configuration/schemas.ts";
import type { Transport } from "../transport/common.ts";
import type {
	DiscoveredSkill,
	SkillDiscoveryResolver,
	ToolRunner,
	ToolValidator,
} from "./bridge-types.ts";

export type AgentdToolDefinition = {
	name: string;
	description: string;
	argumentsSchema: unknown;
};

export type ToolDefinitionLoader = (params: {
	hasMcpServers: boolean;
	hasWebSearch: boolean;
	skills: DiscoveredSkill[];
}) => Promise<{ tools: AgentdToolDefinition[] }>;

export type LoadedTools = Record<
	string,
	{
		name: string;
		description: string;
		providerSchema: unknown;
		extra?: unknown;
	}
>;

export type ToolCall = {
	type: "tool-call";
	name: string;
	toolCallId: string;
	parsed: Record<string, unknown>;
	original: unknown;
};

export type ToolRunResult =
	| {
			type: "output";
			content: Array<
				{ type: "text"; content: string } | { type: "image"; image: ImageInfo }
			>;
			lines?: number;
	  }
	| { type: "invoke-subagent"; name: string }
	| { type: "custom-ir"; data: unknown };

export type LoadToolsOptions = {
	skillDiscover?: SkillDiscoveryResolver;
	toolDefinitions?: ToolDefinitionLoader;
};

function homeDir() {
	return process.env["HOME"] ?? process.env["USERPROFILE"] ?? homedir();
}

export async function loadTools(
	transport: Transport,
	_signal: AbortSignal,
	config: Config,
	options: LoadToolsOptions = {},
): Promise<Partial<LoadedTools>> {
	if (!options.toolDefinitions) {
		throw new Error("Tool definitions bridge is required");
	}
	const loaded: Partial<LoadedTools> = {};
	const searchConfig = await readSearchConfig(config);
	const discoveredSkills = options.skillDiscover
		? (
				await options.skillDiscover({
					cwd: transport.cwd,
					home: homeDir(),
					configuredSkillPaths: config.skills?.paths ?? [],
				})
			).skills
		: [];
	const definitions = await options.toolDefinitions({
		hasMcpServers:
			config.mcpServers != null && Object.keys(config.mcpServers).length > 0,
		hasWebSearch: searchConfig != null,
		skills: discoveredSkills,
	});

	for (const definition of definitions.tools) {
		const tool = agentdToolDefinition(definition);
		loaded[definition.name] =
			definition.name === "skill"
				? { ...tool, extra: { skills: discoveredSkills } }
				: tool;
	}

	return loaded;
}

function agentdToolDefinition(
	definition: AgentdToolDefinition,
): LoadedTools[string] {
	return {
		name: definition.name,
		description: definition.description,
		providerSchema: definition.argumentsSchema,
	};
}

export async function runTool(
	abortSignal: AbortSignal,
	transport: Transport,
	loaded: Partial<LoadedTools>,
	call: ToolCall,
	config: Config,
	toolRun?: ToolRunner,
): Promise<Result<ToolRunResult, string>> {
	const def = lookup(loaded, call);
	if (!def.success) return def;
	if (!toolRun) return err(`Tool runner is required for ${call.name}`);
	const modelContext = getModelFromConfig(config, null).context;
	const context = await agentdToolRunContext(call.name, config, def.data);
	if (!context.success) return context;
	if (abortSignal.aborted) return err("Tool run aborted");
	try {
		const result = await toolRun(
			{
				toolName: call.name,
				cwd: transport.cwd,
				...(transport.toolRunTransport
					? { transport: transport.toolRunTransport() }
					: {}),
				toolCallId: call.toolCallId,
				toolCall: call,
				parsed: asRecord(call.parsed),
				modelContext,
				...context.data,
			},
			{ abortSignal, cancelOnAbort: true },
		);
		if (result.status === "completed")
			return ok(result.result as ToolRunResult);
		return err(result.message);
	} catch (error) {
		return err(errorToString(error));
	}
}

export async function validateTool(
	abortSignal: AbortSignal,
	transport: Transport,
	loaded: Partial<LoadedTools>,
	tool: ToolCall,
	toolValidate: ToolValidator,
): Promise<Result<null, string>> {
	const toolDef = lookup(loaded, tool);
	if (!toolDef.success) return toolDef;
	if (abortSignal.aborted) return err("Tool validation aborted");
	try {
		const validation = await toolValidate(
			{
				toolName: tool.name,
				cwd: transport.cwd,
				parsed: tool.parsed,
			},
			{ abortSignal, cancelOnAbort: true },
		);
		if (validation.status === "valid") return ok(null);
		return err(validation.message);
	} catch (error) {
		return err(errorToString(error));
	}
}

function isLanguageServerRunTool(name: string): boolean {
	return (
		name === "lsp-definition" ||
		name === "lsp-implementation" ||
		name === "lsp-references" ||
		name === "lsp-hover" ||
		name === "lsp-incoming-calls" ||
		name === "lsp-outgoing-calls" ||
		name === "lsp-diagnostics" ||
		name === "lsp-document-symbol"
	);
}

async function agentdToolRunContext(
	toolName: string,
	config: Config,
	toolDef: LoadedTools[string],
): Promise<
	Result<
		{
			mcpServers?: unknown;
			lsp?: unknown;
			webSearch?: unknown;
			userName?: string;
			skills?: unknown;
		},
		string
	>
> {
	if (toolName === "mcp") {
		return ok({ mcpServers: config.mcpServers ?? null });
	}
	if (isLanguageServerRunTool(toolName)) {
		return ok({ lsp: config.lsp ?? null });
	}
	if (toolName === "web-search") {
		const searchConfig = await readSearchConfig(config);
		if (searchConfig == null)
			return err("No web search configuration available");
		return ok({
			webSearch: {
				searchUrl: searchConfig.url,
				searchKey: searchConfig.key,
			},
		});
	}
	if (toolName === "skill") {
		const extra = asRecord((toolDef as { extra?: unknown }).extra);
		return ok({ userName: config.yourName, skills: extra["skills"] ?? [] });
	}
	return ok({});
}

function asRecord(value: unknown): Record<string, unknown> {
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return {};
}

function lookup(
	loaded: Partial<LoadedTools>,
	tool: ToolCall,
): Result<LoadedTools[string], string> {
	const def = loaded[tool.name];
	if (def == null) return err(`No tool named ${tool.name}`);
	return ok(def);
}
