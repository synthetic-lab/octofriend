export type DiscoveredSkill = {
	name: string;
	description: string;
	license?: string | null;
	compatibility?: string | null;
	metadata: Record<string, string>;
	instructions: string;
	path: string;
	skillFilePath: string;
};

export type SkillDiscoveryParams = {
	cwd: string;
	home: string;
	configuredSkillPaths: string[];
};

export type SkillDiscoveryResult = {
	skills: DiscoveredSkill[];
};

export type SkillDiscoveryResolver = (
	params: SkillDiscoveryParams,
) => Promise<SkillDiscoveryResult>;

export type ToolPermissionParams = {
	toolName: string;
	cwd: string;
	parsed: unknown;
};

export type ToolPermissionResult = {
	whitelistKey: string;
	skipConfirmation: boolean;
	alwaysRequestPermission: boolean;
};

export type ToolPermissionResolver = (
	params: ToolPermissionParams,
) => Promise<ToolPermissionResult>;

export type ToolRunParams = ToolRunBaseParams & ToolRunContextParams;

type ToolRunBaseParams = {
	toolName: string;
	cwd: string;
	toolCallId: string;
	toolCall: unknown;
	parsed: unknown;
	transport?: unknown;
};

type ToolRunContextParams = {
	modelContext?: number;
	mcpServers?: unknown;
	lsp?: unknown;
	webSearch?: unknown;
	userName?: string;
	skills?: unknown;
};

export type ToolRunHookResult =
	| { status: "completed"; result: unknown }
	| { status: "error"; message: string };

export type ToolRunOptions = {
	abortSignal?: AbortSignal;
	cancelOnAbort?: boolean;
};

export type ToolRunner = (
	params: ToolRunParams,
	options?: ToolRunOptions,
) => Promise<ToolRunHookResult>;

export type ToolValidateParams = {
	toolName: string;
	cwd: string;
	parsed: unknown;
};

export type ToolValidateResult =
	| { status: "valid" }
	| { status: "error"; message: string };

export type ToolValidateOptions = {
	abortSignal?: AbortSignal;
	cancelOnAbort?: boolean;
};

export type ToolValidator = (
	params: ToolValidateParams,
	options?: ToolValidateOptions,
) => Promise<ToolValidateResult>;
