import type { ImageInfo } from "../../input/image_attachments.ts";
import type { TrajectoryArcRunner } from "../../internal/agent-trajectory-runtime/main.ts";
import type {
	Config,
	ModelConfig,
} from "../../internal/configuration/schemas.ts";
import type { HistoryItem } from "../../internal/conversation-history/main.ts";
import type { ToolCall } from "../../internal/llm-ir/main.ts";
import type {
	OctoIR,
	BuiltInToolContracts as toolMap,
} from "../../internal/octo-agent-ir/main.ts";
import type {
	SkillDiscoveryResolver,
	ToolPermissionResolver,
	ToolRunner,
} from "../../internal/tool-orchestration/bridge-types.ts";
import type { ToolDefinitionLoader } from "../../internal/tool-orchestration/main.ts";
import type { Transport } from "../../internal/transport/common.ts";
import type { QuotaData } from "./quota.ts";

export type RunArgs = {
	config: Config;
	transport: Transport;
	trajectoryArcRun?: TrajectoryArcRunner;
	toolPermission?: ToolPermissionResolver;
	skillDiscover?: SkillDiscoveryResolver;
	toolDefinitions?: ToolDefinitionLoader;
	toolRun?: ToolRunner;
};

export type ToolCallRequest = ToolCall<typeof toolMap>;

export type InflightResponseType = {
	type: "inflight-response";
	content: string;
	reasoningContent?: string | null;
};

export type AppModeData =
	| {
			mode: "input";
			vimMode: "NORMAL" | "INSERT";
	  }
	| {
			mode: "responding";
			inflightResponse: InflightResponseType;
			abortController: AbortController;
	  }
	| {
			mode: "tool-call";
			toolReqs: ToolCallRequest[];
			runningToolCallId: string | null;
			abortController: AbortController;
	  }
	| {
			mode: "error-recovery";
	  }
	| {
			mode: "payment-error";
			error: string;
	  }
	| {
			mode: "rate-limit-error";
			error: string;
	  }
	| {
			mode: "request-error";
			error: string;
			curlCommand: string | null;
	  }
	| {
			mode: "compaction-error";
			error: string;
			curlCommand: string | null;
	  }
	| {
			mode: "diff-apply";
			abortController: AbortController;
	  }
	| {
			mode: "fix-json";
			abortController: AbortController;
	  }
	| {
			mode: "compacting";
			inflightResponse: InflightResponseType;
			abortController: AbortController;
	  }
	| {
			mode: "menu";
	  };

export type UiState = {
	preMenuModeData: AppModeData | null;
	_notifyTimer: NodeJS.Timeout | null;
	sessionAutoNotify: boolean;
	notifyOnce: boolean;
	modeData: AppModeData;
	modelOverride: string | null;
	quotaData: QuotaData | null;
	byteCount: number;
	query: string;
	history: HistoryItem<OctoIR>[];
	clearNonce: number;
	lastUserPromptIndex: number | null;
	whitelist: Set<string>;
	notifyReadyForInput: (config: Config) => void;
	cancelNotifyReadyForInput: () => void;
	setNotifyOnce: (notifyOnce: boolean) => void;
	setNotifySession: (notifySession: boolean) => void;
	input: (
		args: RunArgs & { query: string; images?: ImageInfo[] },
	) => Promise<void>;
	runTool: (args: RunArgs & { toolReq: ToolCallRequest }) => Promise<void>;
	rejectTool: (toolCall: ToolCallRequest) => void;
	abortResponse: () => void;
	toggleMenu: () => void;
	openMenu: () => void;
	closeMenu: () => void;
	setVimMode: (vimMode: "INSERT" | "NORMAL") => void;
	resetPreMenuVimMode: () => void;
	setModelOverride: (m: string) => void;
	setQuery: (query: string) => void;
	retryFrom: (
		mode:
			| "payment-error"
			| "rate-limit-error"
			| "request-error"
			| "compaction-error",
		args: RunArgs,
	) => Promise<void>;
	editAndRetryFrom: (
		mode: "request-error" | "compaction-error",
		args: RunArgs,
	) => void;
	notify: (notif: string) => void;
	addToWhitelist: (whitelistKey: string) => Promise<void>;
	isWhitelisted: (whitelistKey: string) => Promise<boolean>;
	clearHistory: () => void;
	_maybeHandleAbort: (signal: AbortSignal) => boolean;
	runAgent: (args: RunArgs) => Promise<void>;
};

export type AppStateSet = (
	partial: Partial<UiState> | ((state: UiState) => Partial<UiState>),
) => void;
export type AppStateGet = () => UiState;
export type ModelHookConfig = ModelConfig;
