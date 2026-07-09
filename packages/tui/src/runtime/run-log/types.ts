import type { QuotaData } from "../../shell/state/quota";
import type {
	AssistantMessage,
	Content,
	MalformedToolRequest,
	ToolValidationErrorMessage,
} from "../models/ir/main";
import type { BuiltInToolContracts, OctoIR } from "../agent/ir/main";
import type { ToolCall as BuiltInToolCall } from "../tools/main";

type RequestCompilerError =
	| { type: "request-error"; requestError: string; curl: string }
	| { type: "auth-error"; requestError: string; curl: string }
	| { type: "payment-error"; requestError: string; curl: string }
	| { type: "rate-limit-error"; requestError: string; curl: string };

export const SKIP_INVALID_REASON =
	"One of your other tool calls was invalid, so no tool calls were run";

export type ToolMap = typeof BuiltInToolContracts;
export type ToolCallRequest = BuiltInToolCall;

export type TrajectoryOutputIR =
	| AssistantMessage<ToolMap>
	| {
			role: "tool-parse-error";
			malformedRequest: MalformedToolRequest;
	  }
	| ToolValidationErrorMessage<ToolMap>
	| {
			role: "tool-skip-output";
			toolCall: ToolCallRequest;
			reason: string;
	  }
	| Extract<OctoIR, { role: "file-read" | "file-mutate" }>
	| {
			role: "checkpoint";
			content: Content["content"];
	  };

export type ResponseTokenTypes = "reasoning" | "content" | "tool";
export type CompactionTokenTypes = Exclude<ResponseTokenTypes, "tool">;

export type AssistantBuffer<AllowedType extends string> = {
	[K in AllowedType]?: string;
};

export type AssistantDelta<AllowedType extends string> = {
	value: string;
	type: AllowedType;
};

export type CompactionType = {
	checkpoint: TrajectoryOutputIR & { role: "checkpoint" };
};

export type RecoverableRequestError = Extract<
	RequestCompilerError,
	{ type: "auth-error" | "payment-error" | "rate-limit-error" }
>;

export type AutocompactionStream = {
	type: "autocompaction-stream";
	buffer: AssistantBuffer<CompactionTokenTypes>;
	delta: AssistantDelta<CompactionTokenTypes>;
};

export type StateEvents = {
	startResponse: null;
	responseProgress: {
		buffer: AssistantBuffer<ResponseTokenTypes>;
		delta: AssistantDelta<ResponseTokenTypes>;
	};
	startCompaction: null;
	compactionProgress: AutocompactionStream;
	compactionParsed: CompactionType;
	autofixingJson: null;
	autofixingDiff: null;
	retryTool: {
		irs: TrajectoryOutputIR[];
	};
	onQuotaUpdated: QuotaData;
};

export type AnyState = keyof StateEvents;

export type Finish = {
	type: "finish";
	irs: TrajectoryOutputIR[];
	reason:
		| {
				type: "abort";
		  }
		| {
				type: "needs-response";
		  }
		| {
				type: "request-tool";
				toolCalls: ToolCallRequest[];
		  }
		| RequestCompilerError
		| {
				type: "compaction-error";
				requestError: string;
				curl: string | null;
		  };
};

export type TrajectoryHandler = {
	[K in AnyState]: (state: StateEvents[K]) => void;
};
