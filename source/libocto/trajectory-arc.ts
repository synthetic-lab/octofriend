import { registry } from "antipattern";
import type { t } from "structural";
import type { Transport } from "../transports/transport-common.ts";
import { err, ok, type Result } from "./result.ts";
import { sleep } from "./sleep.ts";
import { combineSignals } from "./signals.ts";
import type {
  Agent,
  AssistantMessage,
  Checkpoint,
  LlmIR,
  LoweredIR,
  ToolParseErrorMessage,
  ToolSkipOutputMessage,
  ToolValidationErrorMessage,
} from "./llm-ir.ts";
import type { LoadedTools, ToolCall, ToolDef } from "./tool-def.ts";
import type { AutofixJsonFn, Compiler, CompilerError } from "./compilers/compiler-interface.ts";
import { compilerUsage } from "./compilers/compiler-interface.ts";
import {
  generateCompactionCheckpointContent,
  shouldAutoCompactHistory,
  type CompactionError,
} from "./compilers/autocompact.ts";

const SKIP_INVALID_REASON = "One of your other tool calls was invalid, so no tool calls were run";

export type TrajectoryArcTokenTypes = "reasoning" | "content" | "tool";
type CompactionTokenTypes = Exclude<TrajectoryArcTokenTypes, "tool">;

export type AssistantBuffer<AllowedType extends string> = {
  [K in AllowedType]?: string;
};
export type AssistantDelta<AllowedType extends string> = {
  value: string;
  type: AllowedType;
};

export type AutocompactionStream = {
  type: "autocompaction-stream";
  buffer: AssistantBuffer<CompactionTokenTypes>;
  delta: AssistantDelta<CompactionTokenTypes>;
};

/*
 * The arc validates and corrects tool calls by dispatching on the tool's declared name, so its
 * internal tool call types are indexed by tool name rather than by key in the agent's tool map.
 * LoadedToolsByName/ToolCallForTools re-associate LoadedTools/ToolCall with their declared names,
 * keeping the name-to-schema correlation visible to the type system.
 */
export type LoadedToolsByName<A extends Agent<any, any, any>> = {
  [K in keyof LoadedTools<A["tools"]> as LoadedTools<A["tools"]>[K]["name"]]: LoadedTools<
    A["tools"]
  >[K];
};

export type ToolNames<A extends Agent<any, any, any>> = keyof LoadedToolsByName<A> & string;

export type ToolCallByName<A extends Agent<any, any, any>, Name extends ToolNames<A>> = {
  type: "tool-call";
  name: Name;
  toolCallId: string;
  original: t.GetType<LoadedToolsByName<A>[Name]["ArgumentsSchema"]>;
  parsed: t.GetType<LoadedToolsByName<A>[Name]["ParsedSchema"]>;
};

export type ToolCallForTools<A extends Agent<any, any, any>> = {
  [Name in ToolNames<A>]: ToolCallByName<A, Name>;
}[ToolNames<A>];

export type ToolDataFor<Def> =
  Def extends ToolDef<infer Data, infer _N, infer _A, infer _P, infer _S, infer _E> ? Data : never;

// Data that is valid for every tool the agent loads.
export type AgentToolData<A extends Agent<any, any, any>> = UnionToIntersection<
  ToolDataFor<LoadedToolsByName<A>[ToolNames<A>]>
>;

type UnionToIntersection<U> = (U extends U ? (x: U) => void : never) extends (x: infer I) => void
  ? I
  : never;

export type TrajectoryArcIR<A extends Agent<any, any, any>> =
  | AssistantMessage<A["tools"]>
  | ToolParseErrorMessage
  | ToolValidationErrorMessage<A["tools"]>
  | ToolSkipOutputMessage<A["tools"]>
  | Checkpoint;

export type RecoverableRequestError = Extract<
  CompilerError,
  { type: "payment-error" | "rate-limit-error" }
>;

export type RetryableRequestError = Extract<
  CompilerError,
  { type: "request-error" | "stream-error" | "rate-limit-error" }
>;

export type StaticFinishReasons<A extends Agent<any, any, any>> =
  | {
      type: "abort";
    }
  | {
      type: "needs-response";
    }
  | {
      type: "request-tool";
      toolCalls: Array<ToolCall<A["tools"]>>;
    }
  | {
      type: "request-error";
      requestError: string;
      curl: string;
    }
  | {
      type: "auth-error";
      authError: string;
    }
  | RecoverableRequestError
  | {
      type: "compaction-error";
      requestError: string;
      curl: string | null;
    };

export type ValidationRetryBudgetFinishReason = {
  type: "validation-retry-budget-exceeded";
};

export type RequestErrorRetryBudgetFinishReason = {
  type: "request-error-retry-budget-exceeded";
  error: RetryableRequestError;
};

export type TrajectoryArcFinish<Reason> = {
  type: "finish";
  reason: Reason;
};

export type AllFinishReasons<A extends Agent<any, any, any>> =
  | StaticFinishReasons<A>
  | ValidationRetryBudgetFinishReason
  | RequestErrorRetryBudgetFinishReason;

type ValidationBudgetParams<A extends Agent<any, any, any>, Model> = TrajectoryArcParams<
  A,
  Model
> & {
  validationRetries: number;
};

type RequestErrorBudgetParams<A extends Agent<any, any, any>, Model> = TrajectoryArcParams<
  A,
  Model
> & {
  requestErrorRetries: RequestErrorRetriesConfig & {
    maxRetryCount: number;
  };
};

type BothBudgetsParams<A extends Agent<any, any, any>, Model> = TrajectoryArcParams<A, Model> & {
  validationRetries: number;
  requestErrorRetries: RequestErrorRetriesConfig & {
    maxRetryCount: number;
  };
};

export type TrajectoryArcEvents<A extends Agent<any, any, any>> = {
  startResponse: null;
  responseProgress: {
    buffer: AssistantBuffer<TrajectoryArcTokenTypes>;
    delta: AssistantDelta<TrajectoryArcTokenTypes>;
  };
  startCompaction: null;
  compactionProgress: AutocompactionStream;
  autofixingJson: null;
  autofixingTool: { tool: string };
  requestRetry: {
    error: RetryableRequestError;
    attempt: number;
    delayMs: number;
    abortController: AbortController;
  };
  onMessage: TrajectoryArcIR<A>;
  onResponseHeaders: Headers;
};

export type ToolCorrectionArgs<Call, Data> = {
  toolCall: Call;
  validationError: string;
  abortSignal: AbortSignal;
  transport: Transport;
  data: Data;
};

export type ToolCorrections<A extends Agent<any, any, any>> = Partial<{
  [Name in ToolNames<A>]: (
    args: ToolCorrectionArgs<ToolCallByName<A, Name>, AgentToolData<A>>,
  ) => Promise<t.GetType<LoadedToolsByName<A>[Name]["ParsedSchema"]> | null>;
}>;

export type ErrorCorrection<A extends Agent<any, any, any>> = {
  json?: AutofixJsonFn;
  tools?: ToolCorrections<A>;
};

export type RequestErrorRetriesConfig = {
  maxRetryCount?: number;
  backoffMs: number;
  maxBackoffMs?: number;
};

export type TrajectoryArcParams<A extends Agent<any, any, any>, Model> = {
  model: Model;
  contextWindow: number;
  messages: Array<LlmIR<A>>;
  tools: Partial<LoadedTools<A["tools"]>>;
  toolData: AgentToolData<A>;
  runCompiler: Compiler<Model>;
  lowerMessages: (messages: Array<LlmIR<A>>) => Array<LoweredIR<A["tools"]>>;
  systemPrompt?: () => Promise<string>;
  transport: Transport;
  abortSignal: AbortSignal;
  errorCorrection?: ErrorCorrection<A>;
  validationRetries?: number;
  requestErrorRetries?: RequestErrorRetriesConfig;
  handler: {
    [K in keyof TrajectoryArcEvents<A>]: (event: TrajectoryArcEvents<A>[K]) => void;
  };
};

/*
 * Given some LLM IR, runs the next arc of the trajectory until one of the finish reasons defined
 * above is hit.
 */
export const trajectoryArc = registry({
  run: runTrajectoryArc,
});

async function runTrajectoryArc<A extends Agent<any, any, any>, Model>(
  params: BothBudgetsParams<A, Model>,
): Promise<TrajectoryArcFinish<AllFinishReasons<A>>>;
async function runTrajectoryArc<A extends Agent<any, any, any>, Model>(
  params: ValidationBudgetParams<A, Model>,
): Promise<TrajectoryArcFinish<StaticFinishReasons<A> | ValidationRetryBudgetFinishReason>>;
async function runTrajectoryArc<A extends Agent<any, any, any>, Model>(
  params: RequestErrorBudgetParams<A, Model>,
): Promise<TrajectoryArcFinish<StaticFinishReasons<A> | RequestErrorRetryBudgetFinishReason>>;
async function runTrajectoryArc<A extends Agent<any, any, any>, Model>(
  params: TrajectoryArcParams<A, Model>,
): Promise<TrajectoryArcFinish<StaticFinishReasons<A>>>;
async function runTrajectoryArc<A extends Agent<any, any, any>, Model>({
  model,
  contextWindow,
  messages,
  tools,
  toolData,
  runCompiler,
  lowerMessages,
  systemPrompt,
  transport,
  abortSignal,
  errorCorrection,
  validationRetries,
  requestErrorRetries,
  handler,
}: TrajectoryArcParams<A, Model>): Promise<TrajectoryArcFinish<AllFinishReasons<A>>> {
  const messagesCopy: Array<LlmIR<A>> = [...messages];
  const emitIrs = (delta: Array<TrajectoryArcIR<A>>) => {
    for (const ir of delta) handler.onMessage(ir);
  };
  const finishWith = (
    reason: AllFinishReasons<A>,
    remaining: Array<TrajectoryArcIR<A>> = [],
  ): TrajectoryArcFinish<AllFinishReasons<A>> => {
    emitIrs(remaining);
    return { type: "finish", reason };
  };

  const jsonCorrector = errorCorrection?.json;
  const jsonCorrectorWithEvent: AutofixJsonFn | undefined = jsonCorrector
    ? (badJson, signal) => {
        handler.autofixingJson(null);
        return jsonCorrector(badJson, signal);
      }
    : undefined;

  let validationAttempts = 0;
  let requestAttempts = 0;

  const consumeValidationRetry = (): boolean => {
    if (validationRetries != null && validationAttempts >= validationRetries) return false;
    validationAttempts += 1;
    return true;
  };

  const maybeRetryRequest = async (
    error: RetryableRequestError,
  ): Promise<"retry" | "exhausted" | "cancelled" | "abort"> => {
    if (requestErrorRetries == null) return "cancelled";
    if (
      requestErrorRetries.maxRetryCount != null &&
      requestAttempts >= requestErrorRetries.maxRetryCount
    ) {
      return "exhausted";
    }
    requestAttempts += 1;

    let delayMs = requestErrorRetries.backoffMs * requestAttempts;
    if (requestErrorRetries.maxBackoffMs != null) {
      delayMs = Math.min(delayMs, requestErrorRetries.maxBackoffMs);
    }

    const retryAbort = new AbortController();
    handler.requestRetry({
      error,
      attempt: requestAttempts,
      delayMs,
      abortController: retryAbort,
    });

    await sleep(delayMs, combineSignals([abortSignal, retryAbort.signal]));
    if (retryAbort.signal.aborted) return "cancelled";
    if (abortSignal.aborted) return "abort";
    return "retry";
  };

  const processToolCall = async <Name extends ToolNames<A>>(
    toolCall: ToolCallByName<A, Name>,
    defsByName: Partial<Record<ToolNames<A>, LoadedToolsByName<A>[ToolNames<A>]>>,
    retryIrs: Array<TrajectoryArcIR<A>>,
  ): Promise<{ type: "ok" } | { type: "aborted"; validationError: string }> => {
    const validation = await validate<A, Name>(
      abortSignal,
      transport,
      defsByName,
      toolData,
      toolCall,
    );

    if (validation.success) {
      // If we got this far, the tool validated successfully. Proactively push a tool-skip-output
      // IR for it, in case other tool calls fail to validate (since all tool calls will be
      // skipped if any are invalid).
      retryIrs.push({
        role: "tool-skip-output",
        toolCall: fromArcToolCall(toolCall),
        reason: SKIP_INVALID_REASON,
      });
      return { type: "ok" };
    }

    const corrector = errorCorrection?.tools?.[toolCall.name];
    if (corrector != null) {
      handler.autofixingTool({ tool: toolCall.name });
      const fixed = await corrector({
        toolCall,
        validationError: validation.error,
        abortSignal,
        transport,
        data: toolData,
      });

      // If we aborted the correction, end the turn with a failed tool call. The assistant
      // message must stay in history: the tool-validation-error answers one of its tool calls,
      // and emitting the answer without the call orphans the tool message — strict backends
      // reject requests where a tool message's tool_call_id doesn't resolve to a preceding
      // assistant tool_call, and any session containing this history 400s on every resumed
      // request.
      if (abortSignal.aborted) {
        return { type: "aborted", validationError: validation.error };
      }

      if (fixed != null) {
        // Validate that the correction applies before marking as fixed
        const fixedValidation = await validate<A, Name>(
          abortSignal,
          transport,
          defsByName,
          toolData,
          {
            type: "tool-call",
            name: toolCall.name,
            toolCallId: toolCall.toolCallId,
            original: toolCall.original,
            parsed: fixed,
          },
        );
        if (fixedValidation.success) {
          // If we got this far, it's valid: update the tool call and keep going
          toolCall.parsed = fixed;
          retryIrs.push({
            role: "tool-skip-output",
            toolCall: fromArcToolCall(toolCall),
            reason: SKIP_INVALID_REASON,
          });
          return { type: "ok" };
        }
      }
    }

    retryIrs.push({
      role: "tool-validation-error",
      toolCall: fromArcToolCall(toolCall),
      error: validation.error,
      aborted: false,
    });
    return { type: "ok" };
  };

  const maybeAutocompact = async (): Promise<
    Result<{ checkpoint: Checkpoint } | null, CompactionError>
  > => {
    const loweredMessages = lowerMessages(messagesCopy);
    if (!shouldAutoCompactHistory(contextWindow, loweredMessages)) return ok(null);

    handler.startCompaction(null);

    const buffer: AssistantBuffer<CompactionTokenTypes> = {};
    const checkpointContent = await generateCompactionCheckpointContent<A>({
      messages: loweredMessages,
      run: compactionMessages =>
        runCompiler<A, undefined>({
          model,
          irs: compactionMessages,
          abortSignal,
          transport,
          autofixJson: jsonCorrector,
          onTokens: (tokens, type) => {
            if (!buffer[type]) buffer[type] = "";
            buffer[type] += tokens;
            handler.compactionProgress({
              type: "autocompaction-stream",
              buffer,
              delta: { value: tokens, type },
            });
          },
        }),
    });

    if (!checkpointContent.success) return checkpointContent;
    if (checkpointContent.data == null) return ok(null);

    return ok({
      checkpoint: {
        role: "checkpoint",
        content: checkpointContent.data,
      },
    });
  };

  const defsByName: Partial<Record<ToolNames<A>, LoadedToolsByName<A>[ToolNames<A>]>> = {};
  for (const def of Object.values(tools)) {
    if (def == null) continue;
    defsByName[def.name as ToolNames<A>] = def;
  }

  while (true) {
    if (abortSignal.aborted) return finishWith({ type: "abort" });

    const compaction = await maybeAutocompact();
    if (!compaction.success) {
      const compactionError = compaction.error;
      if (isRetryableRequestError(compactionError)) {
        const decision = await maybeRetryRequest(compactionError);
        if (decision === "retry") continue;
        if (decision === "abort") return finishWith({ type: "abort" });
        if (decision === "exhausted") {
          return finishWith({
            type: "request-error-retry-budget-exceeded",
            error: compactionError,
          });
        }
      }
      return finishWith(compactionErrorToFinishReason(compactionError));
    }

    if (compaction.data) {
      emitIrs([compaction.data.checkpoint]);
      messagesCopy.push(compaction.data.checkpoint);
    }
    if (abortSignal.aborted) return finishWith({ type: "abort" });

    handler.startResponse(null);

    let irs: Array<TrajectoryArcIR<A>> = [];
    const buffer: AssistantBuffer<TrajectoryArcTokenTypes> = {};
    const loweredMessages = lowerMessages(messagesCopy);
    const result = await runCompiler<A, Partial<LoadedTools<A["tools"]>>>({
      model,
      irs: loweredMessages,
      abortSignal,
      transport,
      tools,
      systemPrompt,
      autofixJson: jsonCorrectorWithEvent,
      onTokens: (tokens, type) => {
        if (!buffer[type]) buffer[type] = "";
        buffer[type] += tokens;
        handler.responseProgress({
          buffer,
          delta: { type, value: tokens },
        });
      },
    });

    function maybeBufferedMessage(): Array<TrajectoryArcIR<A>> {
      if (buffer.content || buffer.reasoning || buffer.tool) {
        return [
          ...irs,
          {
            role: "assistant",
            content: buffer.content || "",
            reasoningContent: buffer.reasoning,
            usage: compilerUsage(0, 0),
          },
        ];
      }
      return [];
    }

    const headers = result.success
      ? result.data.headers
      : "headers" in result.error
        ? result.error.headers
        : undefined;
    if (headers) handler.onResponseHeaders(headers);

    if (abortSignal.aborted) return finishWith({ type: "abort" }, maybeBufferedMessage());

    if (!result.success) {
      const requestError = result.error;
      if (isRetryableRequestError(requestError)) {
        const decision = await maybeRetryRequest(requestError);
        if (decision === "retry") continue;
        if (decision === "abort") {
          return finishWith({ type: "abort" }, maybeBufferedMessage());
        }
        if (decision === "exhausted") {
          return finishWith(
            { type: "request-error-retry-budget-exceeded", error: requestError },
            maybeBufferedMessage(),
          );
        }
      }
      return finishWith(compilerErrorToFinishReason(requestError), maybeBufferedMessage());
    }

    requestAttempts = 0;

    const assistantMessage = result.data.output;
    irs = [...irs, assistantMessage];

    let malformedRequests = false;
    for (const call of assistantMessage.toolCalls || []) {
      if (call.type === "malformed-tool-request") {
        malformedRequests = true;
        break;
      }
    }

    if (malformedRequests) {
      // Insert tool skips for all of the non-malformed tool call IRs, and ensure the original order
      // is kept in terms of input ordering vs output message ordering
      for (const call of assistantMessage.toolCalls || []) {
        if (call.type === "tool-call") {
          irs.push({
            role: "tool-skip-output",
            toolCall: call,
            reason: "Another tool call in this batch was malformed, so this tool call was skipped",
          });
        } else {
          const _: "malformed-tool-request" = call.type;
          irs.push({
            role: "tool-parse-error",
            malformedRequest: call,
          });
        }
      }

      emitIrs(irs);
      if (!consumeValidationRetry()) {
        return finishWith({ type: "validation-retry-budget-exceeded" });
      }
      messagesCopy.push(...irs);
      continue;
    }

    const { toolCalls } = assistantMessage;

    if (toolCalls == null) {
      return finishWith({ type: "needs-response" }, irs);
    }

    const retryIrs: Array<TrajectoryArcIR<A>> = [];
    const wellformedToolCalls: Array<ToolCallForTools<A>> = [];
    for (const toolCall of toolCalls) {
      if (toolCall.type === "malformed-tool-request") {
        throw new Error(
          "Impossible tool ordering: encountered a malformed tool with no malformed response",
        );
      }
      wellformedToolCalls.push(toArcToolCall(toolCall));
    }

    for (const toolCall of wellformedToolCalls) {
      const outcome = await processToolCall(toolCall, defsByName, retryIrs);
      if (outcome.type === "aborted") {
        return finishWith({ type: "abort" }, [
          ...irs,
          {
            role: "tool-validation-error",
            toolCall: fromArcToolCall(toolCall),
            error: outcome.validationError,
            aborted: true,
          },
        ]);
      }
    }

    // If you have any IRs that need to be retried, retry them
    let needsRetry = false;
    for (const ir of retryIrs) {
      if (ir.role !== "tool-skip-output") {
        needsRetry = true;
        break;
      }
    }
    if (needsRetry) {
      const fullRetryTrajectory = [...irs, ...retryIrs];
      emitIrs(fullRetryTrajectory);
      if (!consumeValidationRetry()) {
        return finishWith({ type: "validation-retry-budget-exceeded" });
      }
      messagesCopy.push(...fullRetryTrajectory);
      continue;
    }

    // Got this far? Everything validated. Return the tool calls
    return finishWith(
      {
        type: "request-tool",
        toolCalls: wellformedToolCalls.map(fromArcToolCall),
      },
      irs,
    );
  }
}

async function validate<A extends Agent<any, any, any>, Name extends ToolNames<A>>(
  abortSignal: AbortSignal,
  transport: Transport,
  defsByName: Partial<Record<ToolNames<A>, LoadedToolsByName<A>[ToolNames<A>]>>,
  toolData: AgentToolData<A>,
  toolCall: ToolCallByName<A, Name>,
): Promise<Result<null, string>> {
  // defsByName was built by indexing each loaded definition by its declared name, so the entry
  // for toolCall.name is the definition of the tool this call targets.
  const def = defsByName[toolCall.name] as LoadedToolsByName<A>[Name] | undefined;
  if (def == null) return err(`No tool named ${toolCall.name}`);

  const schemaPair = {
    original: { name: toolCall.name, arguments: toolCall.original },
    parsed: { name: toolCall.name, arguments: toolCall.parsed },
  } as ValidateSchemaPair<LoadedToolsByName<A>[Name]>;

  // AgentToolData is the intersection of every tool's data type, so it is valid for this tool.
  return def.validate(abortSignal, transport, schemaPair, toolData as ToolDataFor<typeof def>);
}

type ValidateSchemaPair<Def> = Def extends {
  validate: (
    abortSignal: AbortSignal,
    transport: Transport,
    schemaPair: infer Pair,
    toolData: never,
  ) => Promise<Result<null, string>>;
}
  ? Pair
  : never;

// ToolCall and ToolCallForTools describe the same runtime values; the arc validates and corrects
// tool calls dispatched by tool name, while the compiler IR types them through the tool map. These
// two coercions re-associate the same union without changing any runtime data.
function toArcToolCall<A extends Agent<any, any, any>>(
  toolCall: ToolCall<A["tools"]>,
): ToolCallForTools<A> {
  return toolCall as ToolCall<A["tools"]> & ToolCallForTools<A>;
}

function fromArcToolCall<A extends Agent<any, any, any>>(
  toolCall: ToolCallForTools<A>,
): ToolCall<A["tools"]> {
  return toolCall as ToolCall<A["tools"]> & ToolCallForTools<A>;
}

function isRecoverableRequestError(error: { type: string }): error is RecoverableRequestError {
  return error.type === "payment-error" || error.type === "rate-limit-error";
}

function isRetryableRequestError(error: { type: string }): error is RetryableRequestError {
  return (
    error.type === "request-error" ||
    error.type === "stream-error" ||
    error.type === "rate-limit-error"
  );
}

function compilerErrorToFinishReason<A extends Agent<any, any, any>>(
  error: CompilerError,
): StaticFinishReasons<A> {
  if (error.type === "auth-error") return error;
  if (isRecoverableRequestError(error)) return error;
  return {
    type: "request-error",
    requestError: error.requestError,
    curl: error.curl,
  };
}

function compactionErrorToFinishReason<A extends Agent<any, any, any>>(
  error: CompactionError,
): StaticFinishReasons<A> {
  switch (error.type) {
    case "auth-error":
    case "payment-error":
    case "rate-limit-error":
      return error;
    case "compaction-error":
    case "request-error":
    case "stream-error":
      return {
        type: "compaction-error",
        requestError: error.requestError,
        curl: error.curl,
      };
  }
}
