import { registry } from "antipattern";
import type { t } from "structural";
import type { Transport } from "../transports/transport-common.ts";
import { err, type Result } from "./result.ts";
import type {
  Agent,
  AgentIR,
  TreeIR,
  AssistantMessage,
  InterruptedByUserIR,
  ModelErrorIR,
  CompilerReadyIR,
  RequestErrorIR,
  ToolParseErrorMessage,
  ToolSkipOutputMessage,
  ToolValidationErrorMessage,
} from "./llm-ir.ts";
import type { LoadedTools, ToolCall, ToolDef } from "./tool-def.ts";
import type { AutofixJsonFn, Compiler, CompilerError } from "./compilers/compiler-interface.ts";
import { compilerUsage } from "./compilers/compiler-interface.ts";
import { userInterruptReason } from "./compilers/ir-prompts.ts";

const SKIP_INVALID_REASON = "One of your other tool calls was invalid, so no tool calls were run";
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

export type AgentToolData<A extends Agent<any, any, any>> = UnionToIntersection<
  ToolDataFor<LoadedToolsByName<A>[ToolNames<A>]>
>;

type UnionToIntersection<U> = (U extends U ? (x: U) => void : never) extends (x: infer I) => void
  ? I
  : never;

export type TrajectoryAssistantRequestIR<A extends Agent<any, any, any>> =
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

export type ToolCorrections<A extends Agent<any, any, any>> = Partial<{
  [Name in ToolNames<A>]: (
    args: ToolCorrectionArgs<ToolCallByName<A, Name>, AgentToolData<A>>,
  ) => Promise<t.GetType<LoadedToolsByName<A>[Name]["ParsedSchema"]> | null>;
}>;

export type ErrorCorrection<A extends Agent<any, any, any>> = {
  json?: AutofixJsonFn;
  tools?: ToolCorrections<A>;
};

export type TrajectoryAssistantRequestParams<A extends Agent<any, any, any>, Model> = {
  model: Model;
  messages: Array<AgentIR<A>>;
  tools: Partial<LoadedTools<A["tools"]>>;
  toolData: AgentToolData<A>;
  runCompiler: Compiler<Model>;
  lowerMessages: (messages: Array<TreeIR<A>>) => Array<CompilerReadyIR<A>>;
  systemPrompt?: (signal: AbortSignal) => Promise<string>;
  transport: Transport;
  abortSignal: AbortSignal;
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

async function runTrajectoryAssistantRequest<A extends Agent<any, any, any>, Model>({
  model,
  messages,
  tools,
  toolData,
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
  const result = await runCompiler<A, Partial<LoadedTools<A["tools"]>>>({
    model,
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
  });

  const headers = result.success
    ? result.data.headers
    : "headers" in result.error
      ? result.error.headers
      : undefined;
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
  if (abortSignal.aborted) {
    if (partial.length === 0) await handler.discardResponseProgress(null);
    return [...partial, interrupted];
  }
  if (!result.success) return [...partial, compilerErrorIR(result.error)];

  const assistant = result.data.output;
  const calls = assistant.toolCalls ?? [];
  if (calls.length === 0) return [assistant];

  const wellformedCalls = calls.filter(
    (call): call is ToolCall<A["tools"]> => call.type === "tool-call",
  );
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

  const defsByName: Partial<Record<ToolNames<A>, LoadedToolsByName<A>[ToolNames<A>]>> = {};
  for (const def of Object.values(tools)) {
    if (def != null) defsByName[def.name as ToolNames<A>] = def;
  }
  const answers: Array<ToolValidationErrorMessage<A["tools"]> | ToolSkipOutputMessage<A["tools"]>> =
    [];
  for (const call of wellformedCalls) {
    const toolCall = toToolCallForTools<A>(call);
    let validation = await validate<A, typeof toolCall.name>(
      abortSignal,
      transport,
      defsByName,
      toolData,
      toolCall,
    );
    if (!validation.success && !abortSignal.aborted) {
      const corrector = errorCorrection?.tools?.[toolCall.name];
      if (corrector != null) {
        await handler.autofixingTool({ tool: toolCall.name });
        const fixed = await corrector({
          toolCall,
          validationError: validation.error,
          abortSignal,
          transport,
          data: toolData,
        });
        if (fixed != null && !abortSignal.aborted) {
          const corrected = { ...toolCall, parsed: fixed };
          const correctedValidation = await validate<A, typeof toolCall.name>(
            abortSignal,
            transport,
            defsByName,
            toolData,
            corrected,
          );
          if (correctedValidation.success) {
            toolCall.parsed = fixed;
            validation = correctedValidation;
          }
        }
      }
    }
    if (validation.success) {
      answers.push({ role: "tool-skip-output", toolCall: call, reason: SKIP_INVALID_REASON });
    } else {
      answers.push({
        role: "tool-validation-error",
        toolCall: call,
        error: validation.error,
        aborted: abortSignal.aborted,
      });
    }
    if (abortSignal.aborted) {
      // Complete all tool answers before returning the interrupted attempt. No persisted
      // prefix may expose unvalidated siblings as runnable work after a crash.
      for (const remaining of wellformedCalls.slice(answers.length)) {
        answers.push({
          role: "tool-skip-output",
          toolCall: remaining,
          reason: SKIP_ABORTED_REASON,
        });
      }
      return [assistant, ...answers, interrupted];
    }
  }

  if (answers.some(answer => answer.role === "tool-validation-error"))
    return [assistant, ...answers];
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

async function validate<A extends Agent<any, any, any>, Name extends ToolNames<A>>(
  abortSignal: AbortSignal,
  transport: Transport,
  defsByName: Partial<Record<ToolNames<A>, LoadedToolsByName<A>[ToolNames<A>]>>,
  toolData: AgentToolData<A>,
  toolCall: ToolCallByName<A, Name>,
): Promise<Result<null, string>> {
  const def = defsByName[toolCall.name] as LoadedToolsByName<A>[Name] | undefined;
  if (def == null) return err(`No tool named ${toolCall.name}`);
  const schemaPair = {
    original: { name: toolCall.name, arguments: toolCall.original },
    parsed: { name: toolCall.name, arguments: toolCall.parsed },
  } as ValidateSchemaPair<LoadedToolsByName<A>[Name]>;
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

// Re-associate tool names with their definitions without changing their payloads.
function toToolCallForTools<A extends Agent<any, any, any>>(
  toolCall: ToolCall<A["tools"]>,
): ToolCallForTools<A> {
  return toolCall as ToolCall<A["tools"]> & ToolCallForTools<A>;
}
