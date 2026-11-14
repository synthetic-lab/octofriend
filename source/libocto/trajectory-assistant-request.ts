import { registry } from "antipattern";
import type { t } from "structural";
import type { Transport } from "./transport.ts";
import { err, ok, type Result } from "./result.ts";
import { combineSignals } from "./signals.ts";
import type {
  Agent,
  AgentIR,
  TreeIR,
  OwnToolCall,
  OwnToolRegistry,
  AssistantMessage,
  InterruptedByUserIR,
  ModelErrorIR,
  CompilerReadyIR,
  RequestErrorIR,
  ToolParseErrorMessage,
  ToolSkipOutputMessage,
  ToolValidationErrorMessage,
} from "./llm-ir.ts";
import type { ToolDef } from "./toolkits/tool-def.ts";
import type { AutofixJsonFn, Compiler, CompilerError } from "./compilers/compiler-interface.ts";
import { compilerUsage } from "./compilers/compiler-interface.ts";
import { userInterruptReason } from "./compilers/ir-prompts.ts";
import type { ExecutionModel } from "./execution.ts";

// A batch is all-or-nothing: one invalid call means its callable siblings are skipped.
const SKIP_BECAUSE_SIBLING_FAILED =
  "One of your other tool calls was invalid, so no tool calls were run";
const SKIP_ABORTED_REASON = "The user aborted the response, so this tool was skipped";

export type TrajectoryAssistantRequestTokenTypes = "reasoning" | "content" | "tool";

export type AssistantBuffer<AllowedType extends string> = {
  [K in AllowedType]?: string;
};
export type AssistantDelta<AllowedType extends string> = {
  value: string;
  type: AllowedType;
};

// Associate loaded tool definitions with the names used in model requests.
type LoadedToolsByName<A extends Agent<any, any, any, any>> = {
  [K in keyof OwnToolRegistry<A> as OwnToolRegistry<A>[K]["name"]]: OwnToolRegistry<A>[K];
};

type LoadedToolNames<A extends Agent<any, any, any, any>> = keyof LoadedToolsByName<A> & string;

// Every loaded definition, keyed by the name the model emits. Some declared tools are not
// loaded on every arc, so this is partial by construction.
type LoadedToolsByNameMap<A extends Agent<any, any, any, any>> = Partial<
  Record<LoadedToolNames<A>, LoadedToolsByName<A>[LoadedToolNames<A>]>
>;

// A call whose name and payloads are correlated with the loaded definition it names: indexing
// LoadedToolsByName by this call's name yields exactly its own schemas.
export type LoadedToolCallByName<
  A extends Agent<any, any, any, any>,
  Name extends LoadedToolNames<A>,
> = {
  type: "tool-call";
  name: Name;
  toolCallId: string;
  original: t.GetType<LoadedToolsByName<A>[Name]["ArgumentsSchema"]>;
  parsed: t.GetType<LoadedToolsByName<A>[Name]["ParsedSchema"]>;
};

// The same union OwnToolCall describes, re-indexed by the name the model emits. Definition
// lookup happens in this view: the compiler's factory-keyed output cannot correlate a call's
// name with the schemas of the definition that name selects.
type LoadedToolCall<A extends Agent<any, any, any, any>> = {
  [Name in LoadedToolNames<A>]: LoadedToolCallByName<A, Name>;
}[LoadedToolNames<A>];

// Per-call validation state for one attempt. An aborted attempt leaves the calls it never
// reached with a null validation.
type CallCheck<A extends Agent<any, any, any, any>> = {
  call: OwnToolCall<A>;
  validation: Result<null, string> | null;
};

type AutofixingToolHandler = {
  autofixingTool: (event: { tool: string }) => Promise<void>;
};

export type ToolDataFor<Def> =
  Def extends ToolDef<infer Data, infer _Provider, infer _N, infer _A, infer _P, infer _S, infer _E>
    ? Data
    : never;

export type AgentToolData<A extends Agent<any, any, any, any>> = UnionToIntersection<
  ToolDataFor<LoadedToolsByName<A>[LoadedToolNames<A>]>
>;

type UnionToIntersection<U> = (U extends U ? (x: U) => void : never) extends (x: infer I) => void
  ? I
  : never;

export type TrajectoryAssistantRequestIR<A extends Agent<any, any, any, any>> =
  | AssistantMessage<A["tools"]>
  | ToolParseErrorMessage
  | ToolValidationErrorMessage<A["tools"]>
  | ToolSkipOutputMessage<A["tools"]>
  | RequestErrorIR
  | InterruptedByUserIR
  | ModelErrorIR;

export type TrajectoryAssistantRequestEvents = {
  startResponse: null;
  responseProgress: {
    buffer: AssistantBuffer<TrajectoryAssistantRequestTokenTypes>;
    delta: AssistantDelta<TrajectoryAssistantRequestTokenTypes>;
  };
  discardResponseProgress: null;
  autofixingJson: null;
  autofixingTool: { tool: string };
  onResponseHeaders: Headers;
};

export type ToolCorrectionArgs<Call, Data> = {
  toolCall: Call;
  validationError: string;
  abortSignal: AbortSignal;
  transport: Transport;
  data: Data;
};

export type ToolCorrections<A extends Agent<any, any, any, any>> = Partial<{
  [Name in LoadedToolNames<A>]: (
    args: ToolCorrectionArgs<LoadedToolCallByName<A, Name>, AgentToolData<A>>,
  ) => Promise<t.GetType<LoadedToolsByName<A>[Name]["ParsedSchema"]> | null>;
}>;

export type ErrorCorrection<A extends Agent<any, any, any, any>> = {
  json?: AutofixJsonFn;
  tools?: ToolCorrections<A>;
};

export type TrajectoryAssistantRequestParams<A extends Agent<any, any, any, any>, Provider> = {
  model: ExecutionModel<Provider>;
  messages: Array<AgentIR<A>>;
  tools: Partial<OwnToolRegistry<A>>;
  data: AgentToolData<A>;
  runCompiler: Compiler<Provider>;
  lowerMessages: (messages: Array<TreeIR<A>>) => Array<CompilerReadyIR<A>>;
  systemPrompt?: (signal: AbortSignal) => Promise<string>;
  transport: Transport;
  abortSignal: AbortSignal;
  quitSignal: AbortSignal;
  errorCorrection?: ErrorCorrection<A>;
  handler: {
    [K in keyof TrajectoryAssistantRequestEvents]: (
      event: TrajectoryAssistantRequestEvents[K],
    ) => Promise<void>;
  };
};

// One response attempt, including local correction and validation. Only progress is
// emitted in flight; the supervisor commits the finalized group and owns all retries.
export const trajectoryAssistantRequest = registry({ run: runTrajectoryAssistantRequest });

async function runTrajectoryAssistantRequest<A extends Agent<any, any, any, any>, Model>(
  params: TrajectoryAssistantRequestParams<A, Model>,
): Promise<Result<Array<TrajectoryAssistantRequestIR<A>>, "quit">> {
  if (params.quitSignal.aborted) return err("quit");
  try {
    const irs = await assistantRequestAttempt({
      ...params,
      abortSignal: combineSignals([params.abortSignal, params.quitSignal]),
    });
    if (params.quitSignal.aborted) return err("quit");
    return ok(irs);
  } catch (error) {
    if (params.quitSignal.aborted) return err("quit");
    throw error;
  }
}

async function assistantRequestAttempt<A extends Agent<any, any, any, any>, Model>({
  model,
  messages,
  tools,
  data,
  runCompiler,
  lowerMessages,
  systemPrompt,
  transport,
  abortSignal,
  errorCorrection,
  handler,
}: TrajectoryAssistantRequestParams<A, Model>): Promise<Array<TrajectoryAssistantRequestIR<A>>> {
  const interrupted: InterruptedByUserIR = {
    role: "interrupted-by-user",
    reason: userInterruptReason(),
  };
  if (abortSignal.aborted) return [interrupted];
  await handler.startResponse(null);
  if (abortSignal.aborted) return [interrupted];

  const jsonCorrector = errorCorrection?.json;
  const jsonCorrectorWithEvent: AutofixJsonFn | undefined = jsonCorrector
    ? async (badJson, signal) => {
        await handler.autofixingJson(null);
        return jsonCorrector(badJson, signal);
      }
    : undefined;
  const buffer: AssistantBuffer<TrajectoryAssistantRequestTokenTypes> = {};
  const result = await runCompiler<A, Partial<OwnToolRegistry<A>>>({
    model,
    backend: model.provider,
    irs: lowerMessages(messages).map(({ converted }) => converted),
    abortSignal,
    transport,
    tools,
    systemPrompt: systemPrompt == null ? undefined : () => systemPrompt(abortSignal),
    autofixJson: jsonCorrectorWithEvent,
    onTokens: async (tokens, type) => {
      if (abortSignal.aborted) return;
      buffer[type] = (buffer[type] ?? "") + tokens;
      await handler.responseProgress({ buffer, delta: { type, value: tokens } });
    },
  }).catch((error: unknown) => {
    if (!abortSignal.aborted) throw error;
    return null;
  });

  const headers = (() => {
    if (result == null) return undefined;
    if (result.success) return result.data.headers;
    if ("headers" in result.error) return result.error.headers;
    return undefined;
  })();
  if (headers) await handler.onResponseHeaders(headers);

  const partial: Array<TrajectoryAssistantRequestIR<A>> = [];
  if (buffer.content || buffer.tool || (!abortSignal.aborted && buffer.reasoning)) {
    partial.push({
      role: "assistant",
      content: buffer.content ?? "",
      reasoningContent: buffer.reasoning,
      usage: compilerUsage(0, 0),
    });
  }
  if (result == null || abortSignal.aborted) {
    if (partial.length === 0) await handler.discardResponseProgress(null);
    return [...partial, interrupted];
  }
  if (!result.success) return [...partial, compilerErrorIR(result.error)];

  const assistant = result.data.output;
  const calls = assistant.toolCalls ?? [];
  if (calls.length === 0) return [assistant];

  const wellformedCalls = calls.filter((call): call is OwnToolCall<A> => call.type === "tool-call");
  if (wellformedCalls.length !== calls.length) {
    const answers = calls.map((call): TrajectoryAssistantRequestIR<A> => {
      if (call.type === "malformed-tool-request") {
        return { role: "tool-parse-error", malformedRequest: call };
      }
      return {
        role: "tool-skip-output",
        toolCall: call,
        reason: "Another tool call in this batch was malformed, so this tool call was skipped",
      };
    });
    return [assistant, ...answers];
  }

  const loadedToolsByName: LoadedToolsByNameMap<A> = {};
  for (const def of Object.values(tools)) {
    if (def != null) loadedToolsByName[def.name as LoadedToolNames<A>] = def;
  }

  const checks: Array<CallCheck<A>> = wellformedCalls.map(call => ({ call, validation: null }));
  for (const check of checks) {
    check.validation = await validateWithCorrection({
      toolCall: asLoadedToolCall<A>(check.call),
      loadedToolsByName,
      data,
      errorCorrection,
      handler,
      abortSignal,
      transport,
    });
    if (abortSignal.aborted) break;
  }

  const anyFailed = checks.some(check => check.validation != null && !check.validation.success);
  const answers: Array<ToolValidationErrorMessage<A["tools"]> | ToolSkipOutputMessage<A["tools"]>> =
    [];
  for (const { call, validation } of checks) {
    if (validation == null) {
      // Aborted before this call was validated. No persisted prefix may expose unvalidated
      // siblings as runnable work after a crash, so every remaining call is answered.
      answers.push({ role: "tool-skip-output", toolCall: call, reason: SKIP_ABORTED_REASON });
    } else if (!validation.success) {
      answers.push({
        role: "tool-validation-error",
        toolCall: call,
        error: validation.error,
        aborted: abortSignal.aborted,
      });
    } else if (anyFailed || abortSignal.aborted) {
      answers.push({
        role: "tool-skip-output",
        toolCall: call,
        reason: SKIP_BECAUSE_SIBLING_FAILED,
      });
    }
  }

  if (abortSignal.aborted) return [assistant, ...answers, interrupted];
  if (anyFailed) return [assistant, ...answers];
  return [assistant];
}

function compilerErrorIR(error: CompilerError): RequestErrorIR | ModelErrorIR {
  switch (error.type) {
    case "auth-error":
      return { role: "auth-error", authError: error.authError };
    case "payment-error":
    case "rate-limit-error":
      return { role: error.type, requestError: error.requestError };
    case "request-error":
    case "stream-error":
    case "unexpected-tool-call":
      return { role: "request-error", requestError: error.requestError, curl: error.curl };
    default: {
      const _exhaustive: never = error;
      return _exhaustive;
    }
  }
}

// The schema pair a definition's own validate() declares, recovered from its signature.
type ValidateSchemaPair<Def> = Def extends {
  validate: (
    abortSignal: AbortSignal,
    transport: Transport,
    schemaPair: infer Pair,
    data: never,
  ) => Promise<Result<null, string>>;
}
  ? Pair
  : never;

async function validate<A extends Agent<any, any, any, any>, Name extends LoadedToolNames<A>>(
  abortSignal: AbortSignal,
  transport: Transport,
  loadedToolsByName: LoadedToolsByNameMap<A>,
  data: AgentToolData<A>,
  toolCall: LoadedToolCallByName<A, Name>,
): Promise<Result<null, string>> {
  const def = loadedToolsByName[toolCall.name] as LoadedToolsByName<A>[Name] | undefined;
  if (def == null) return err(`No tool named ${toolCall.name}`);
  const schemaPair = {
    original: { name: toolCall.name, arguments: toolCall.original },
    parsed: { name: toolCall.name, arguments: toolCall.parsed },
  } as ValidateSchemaPair<LoadedToolsByName<A>[Name]>;
  return def.validate(abortSignal, transport, schemaPair, data as ToolDataFor<typeof def>);
}

/*
 * Validates one call, giving the client's corrector a single chance to fix its parsed payload.
 * The call keeps its original payloads unless the corrected version validates.
 */
async function validateWithCorrection<
  A extends Agent<any, any, any, any>,
  Name extends LoadedToolNames<A>,
>({
  toolCall,
  loadedToolsByName,
  data,
  errorCorrection,
  handler,
  abortSignal,
  transport,
}: {
  toolCall: LoadedToolCallByName<A, Name>;
  loadedToolsByName: LoadedToolsByNameMap<A>;
  data: AgentToolData<A>;
  errorCorrection: ErrorCorrection<A> | undefined;
  handler: AutofixingToolHandler;
  abortSignal: AbortSignal;
  transport: Transport;
}): Promise<Result<null, string>> {
  const validation = await validate<A, Name>(
    abortSignal,
    transport,
    loadedToolsByName,
    data,
    toolCall,
  );
  if (validation.success || abortSignal.aborted) return validation;

  const corrector = errorCorrection?.tools?.[toolCall.name];
  if (corrector == null) return validation;

  await handler.autofixingTool({ tool: toolCall.name });
  const fixed = await corrector({
    toolCall,
    validationError: validation.error,
    abortSignal,
    transport,
    data,
  });
  if (fixed == null || abortSignal.aborted) return validation;

  const correctedValidation = await validate<A, Name>(
    abortSignal,
    transport,
    loadedToolsByName,
    data,
    {
      ...toolCall,
      parsed: fixed,
    },
  );
  if (!correctedValidation.success) return validation;
  toolCall.parsed = fixed;
  return correctedValidation;
}

// The compiler emits calls keyed by tool-map key; definition lookup is keyed by the name the
// model emits. Same members, different indexing, so payloads are untouched.
function asLoadedToolCall<A extends Agent<any, any, any, any>>(
  call: OwnToolCall<A>,
): LoadedToolCall<A> {
  return call as LoadedToolCall<A>;
}
