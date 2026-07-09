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

type UnknownRecord = Record<string, unknown>;

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
	assistantMessageId?: string;
	parsed: UnknownRecord;
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

function hasConfiguredMcpServers(
	mcpServers: Config["mcpServers"] | undefined,
): boolean {
	if (mcpServers == null) return false;
	for (const key in mcpServers) {
		if (Object.hasOwn(mcpServers, key)) return true;
	}
	return false;
}

export async function loadTools(
	transport: Transport,
	abortSignal: AbortSignal,
	config: Config,
	options: LoadToolsOptions = {},
): Promise<Result<Partial<LoadedTools>, string>> {
	if (!options.toolDefinitions) {
		return err("Tool definitions bridge is required");
	}
	if (abortSignal.aborted) return err("Tool load aborted");
	const loaded: Partial<LoadedTools> = {};
	const searchConfig = await readSearchConfig(config);
	if (abortSignal.aborted) return err("Tool load aborted");
	const discoveredSkills = options.skillDiscover
		? (
				await options.skillDiscover({
					cwd: transport.cwd,
					home: homeDir(),
					configuredSkillPaths: config.skills?.paths ?? [],
				})
			).skills
		: [];
	if (abortSignal.aborted) return err("Tool load aborted");
	const definitions = await options.toolDefinitions({
		hasMcpServers: hasConfiguredMcpServers(config.mcpServers),
		hasWebSearch: searchConfig != null,
		skills: discoveredSkills,
	});
	if (abortSignal.aborted) return err("Tool load aborted");

	for (const definition of definitions.tools) {
		const tool = agentdToolDefinition(definition);
		loaded[definition.name] =
			definition.name === "skill"
				? { ...tool, extra: { skills: discoveredSkills } }
				: tool;
	}

	return ok(loaded);
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

export async function preflightToolCall(
	abortSignal: AbortSignal,
	transport: Transport,
	call: ToolCall,
): Promise<Result<ToolCall, string>> {
	if (call.name !== "edit" && call.name !== "rewrite") return ok(call);
	const filePath = stringField(call.parsed, "filePath");
	if (filePath == null) return ok(call);
	const parsed = { ...call.parsed };
	delete parsed["originalFileContents"];
	try {
		const originalFileContents = await transport.readFile(
			abortSignal,
			filePath,
		);
		parsed["originalFileContents"] = originalFileContents;
	} catch {
		delete parsed["originalFileContents"];
	}
	return ok({ ...call, parsed });
}

function stringField(value: UnknownRecord, key: string): string | null {
	const field = value[key];
	return typeof field === "string" ? field : null;
}

export type RunToolRequest = {
	abortSignal: AbortSignal;
	transport: Transport;
	loaded: Partial<LoadedTools>;
	call: ToolCall;
	config: Config;
	toolRun?: ToolRunner;
};

export async function runTool(
	request: RunToolRequest,
): Promise<Result<ToolRunResult, string>> {
	const { abortSignal, transport, loaded, call, config, toolRun } = request;
	const def = lookup(loaded, call);
	if (!def.success) return def;
	if (!toolRun) return err(`Tool runner is required for ${call.name}`);
	const modelContext = getModelFromConfig(config, null).context;
	const context = await agentdToolRunContext(call.name, config, def.data);
	if (!context.success) return context;
	if (abortSignal.aborted) return err("Tool run aborted");
	const preflight = await preflightToolCall(abortSignal, transport, call);
	if (!preflight.success) return preflight;
	const preflightedCall = preflight.data;
	try {
		const result = await toolRun(
			{
				toolName: preflightedCall.name,
				cwd: transport.cwd,
				...(transport.toolRunTransport
					? { transport: transport.toolRunTransport() }
					: {}),
				toolCallId: preflightedCall.toolCallId,
				toolCall: preflightedCall,
				parsed: asRecord(preflightedCall.parsed),
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

function asRecord(value: unknown): UnknownRecord {
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		return value as UnknownRecord;
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
