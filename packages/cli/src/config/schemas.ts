export type KeyConfig = Record<string, string>;
export type McpServerConfig = {
	command: string;
	args?: string[];
	env?: Record<string, string>;
};
export type LspServerConfig = {
	command: string[];
	extensions: string[];
	rootCandidates: string[];
};
export type LspEntry = { disabled: true } | LspServerConfig;
export type Auth =
	| {
			type: "env";
			name: string;
			credential?: "api-key" | "chatgpt-oauth";
	  }
	| {
			type: "command";
			command: string[];
	  };

export type AuthError =
	| { type: "missing"; message: string }
	| {
			type: "command_failed";
			message: string;
			exitCode?: number;
			stderr?: string;
	  }
	| { type: "invalid"; message: string };

export type KeyResult =
	| { ok: true; key: string }
	| { ok: false; error: AuthError };

export type ModelConfig = {
	type?: "standard" | "openai-responses" | "anthropic" | "gemini";
	nickname: string;
	baseUrl: string;
	apiEnvVar?: string;
	auth?: Auth;
	model: string;
	context: number;
	reasoning?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
	thinkingBudgetTokens?: number;
	modalities?: {
		image?: {
			enabled: boolean;
			maxSizeMB: number;
			acceptedMimeTypes: string[];
		};
	};
};

export type AutofixModelConfig = {
	type?: "standard" | "openai-responses" | "anthropic" | "gemini";
	baseUrl: string;
	apiEnvVar?: string;
	auth?: Auth;
	model: string;
};

export type ConfigIdentity = {
	configVersion?: number;
	yourName: string;
};

export type ConfigModels = {
	models: ModelConfig[];
	diffApply?: AutofixModelConfig;
	fixJson?: AutofixModelConfig;
};

export type ConfigEditing = {
	vimEmulation?: {
		enabled: boolean;
	};
	search?: {
		url: string;
		apiEnvVar?: string;
		auth?: Auth;
	};
};

export type ConfigIntegrations = {
	defaultApiKeyOverrides?: Record<string, string>;
	mcpServers?: Record<string, McpServerConfig>;
	lsp?: false | Record<string, LspEntry>;
	skills?: {
		paths?: string[];
	};
	notifications?: {
		notifyCommand?: string;
		notifyTimeoutMs?: number;
		alwaysNotify?: boolean;
	};
};

export type Config = ConfigIdentity &
	ConfigModels &
	ConfigEditing &
	ConfigIntegrations;
