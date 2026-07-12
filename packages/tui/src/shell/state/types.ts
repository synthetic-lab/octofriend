import type { ImageInfo } from "../../input/images.ts";
import type {
	OctoIR,
	BuiltInToolContracts as toolMap,
} from "../../runtime/agent/ir/main.ts";
import type { Config, ModelConfig } from "../../runtime/config/schemas.ts";
import type { HistoryItem } from "../../runtime/history/main.ts";
import type { ToolCall } from "../../runtime/models/ir/main.ts";
import type { TrajectoryArcRunner } from "../../runtime/run-log/main.ts";
import type {
	SkillDiscoveryResolver,
	ToolPermissionResolver,
	ToolRunner,
} from "../../runtime/tools/bridge-types.ts";
import type { ToolDefinitionLoader } from "../../runtime/tools/main.ts";
import type { Transport } from "../../runtime/workspace/common.ts";
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
			mode: "auth-error";
			error: string;
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

type UiModeState = {
	preMenuModeData: AppModeData | null;
	modeData: AppModeData;
	setVimMode: (vimMode: "INSERT" | "NORMAL") => void;
	resetPreMenuVimMode: () => void;
};

type UiNotificationState = {
	_notifyTimer: NodeJS.Timeout | null;
	sessionAutoNotify: boolean;
	notifyOnce: boolean;
	notifyReadyForInput: (config: Config) => void;
	cancelNotifyReadyForInput: () => void;
	setNotifyOnce: (notifyOnce: boolean) => void;
	setNotifySession: (notifySession: boolean) => void;
	notify: (notif: string) => void;
};

type UiConversationState = {
	query: string;
	sessionId: string;
	history: HistoryItem<OctoIR>[];
	clearNonce: number;
	lastUserPromptIndex: number | null;
	pendingRejectedToolCall: ToolCallRequest | null;
	setQuery: (query: string) => void;
	clearHistory: () => void;
	hydrateSession: (sessionId: string, history: HistoryItem<OctoIR>[]) => void;
};

type UiToolState = {
	whitelist: Set<string>;
	runTool: (args: RunArgs & { toolReq: ToolCallRequest }) => Promise<void>;
	rejectTool: (toolCall: ToolCallRequest) => void;
	addToWhitelist: (whitelistKey: string) => Promise<void>;
	isWhitelisted: (whitelistKey: string) => Promise<boolean>;
};

type UiModelState = {
	modelOverride: string | null;
	quotaData: QuotaData | null;
	byteCount: number;
	setModelOverride: (m: string) => void;
};

type UiMenuActions = {
	toggleMenu: () => void;
	openMenu: () => void;
	closeMenu: () => void;
};

type UiRunActions = {
	input: (
		args: RunArgs & { query: string; images?: ImageInfo[] },
	) => Promise<void>;
	abortResponse: () => void;
	_maybeHandleAbort: (signal: AbortSignal) => boolean;
	runAgent: (args: RunArgs & { compactOnly?: boolean }) => Promise<void>;
	compactHistory: (args: RunArgs) => Promise<void>;
};

type UiRetryActions = {
	retryFrom: (
		mode:
			| "auth-error"
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
};

export type UiState = UiModeState &
	UiNotificationState &
	UiConversationState &
	UiToolState &
	UiModelState &
	UiMenuActions &
	UiRunActions &
	UiRetryActions;

export type AppStateSet = (
	partial: Partial<UiState> | ((state: UiState) => Partial<UiState>),
) => void;
export type AppStateGet = () => UiState;
export type ModelHookConfig = ModelConfig;
