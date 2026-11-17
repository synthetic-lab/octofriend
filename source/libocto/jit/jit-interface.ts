import { err, ok, type Result } from "../result.ts";
import type { Agent, AssistantMessage, LoweredIR, OwnToolRegistry } from "../llm-ir.ts";
import type { ToolMap } from "../toolkits/tool-def.ts";
import { Transport } from "../transport.ts";
import type { ExecutionModel } from "../execution.ts";
import type { MultimodalConfig } from "../modalities.ts";

export type CompilerIR<A extends Agent<any, any, any, any>> = LoweredIR<A["tools"]>;

/*
 * The compile half of the jit: IR in, a provider-native request body out, with no execution.
 *
 * Each provider's compiler module owns the whole body — messages, tool schemas, model options,
 * streaming flags — so a caller can hand the result to their own transport (an HTTP client, or a
 * queue of chat-completions-shaped jobs) instead of libocto's interpreter. Compilers live below
 * the interpreters: the shipped interpreters import them, never the other way around.
 */

// The minimum a compiler needs to know about the model: the wire name, and which modalities it can
// render. ExecutionModel satisfies this, so interpreters can pass their model straight through.
export type CompileModel = {
  model: string;
  modalities: MultimodalConfig | null;
};

export type CompileInputs<A extends Agent<any, any, any, any>> = {
  model: CompileModel;
  irs: Array<CompilerIR<A>>;
  systemPrompt?: () => Promise<string>;
  tools?: Partial<OwnToolRegistry<A>>;
};

export type InterpreterTokenType<Tools = unknown> = [Tools] extends [undefined]
  ? "reasoning" | "content"
  : "reasoning" | "content" | "tool";

export type InterpreterModality = "text" | "vision";
export type InterpreterModalities = readonly InterpreterModality[];

export type InterpreterUsage = {
  input: {
    cached: number;
    uncached: number;
    total: number;
  };
  output: number;
};

export function interpreterUsage(
  inputTotal: number,
  output: number,
  cached: number = 0,
): InterpreterUsage {
  return {
    input: {
      cached,
      uncached: Math.max(0, inputTotal - cached),
      total: inputTotal,
    },
    output,
  };
}

export function interpreterUsageHasTokens(usage: InterpreterUsage): boolean {
  return usage.input.total !== 0 || usage.output !== 0;
}

export type InterpreterError =
  | {
      type: "auth-error";
      authError: string;
    }
  | {
      type: "request-error";
      requestError: string;
      curl: string;
      headers?: Headers;
    }
  | {
      type: "stream-error";
      requestError: string;
      curl: string;
      usage: InterpreterUsage;
      headers: Headers;
    }
  | {
      type: "payment-error";
      requestError: string;
      curl: string;
      headers: Headers;
    }
  | {
      type: "rate-limit-error";
      requestError: string;
      curl: string;
      headers: Headers;
    }
  | {
      type: "unexpected-tool-call";
      requestError: string;
      curl: string;
      usage: InterpreterUsage;
      headers: Headers;
    };

export function unexpectedToolCallError(
  curl: string,
  usage: InterpreterUsage,
  headers: Headers,
): InterpreterError {
  return {
    type: "unexpected-tool-call",
    requestError: "Model returned tool calls even though no tools were provided.",
    curl,
    usage,
    headers,
  };
}

export type AssistantMessageWithoutToolCalls<T extends ToolMap<any, any>> = Omit<
  AssistantMessage<T>,
  "toolCalls"
> & {
  toolCalls?: never;
};

type AssistantMessageForTools<A extends Agent<any, any, any, any>, Tools> = [Tools] extends [
  undefined,
]
  ? AssistantMessageWithoutToolCalls<A["tools"]>
  : AssistantMessage<A["tools"]>;

export type InterpreterResultData<A extends Agent<any, any, any, any>, Tools> = {
  output: AssistantMessageForTools<A, Tools>;
  curl: string;
  headers: Headers;
  usage: InterpreterUsage;
};

export type InterpreterResult<A extends Agent<any, any, any, any>, Tools = unknown> = Result<
  InterpreterResultData<A, Tools>,
  InterpreterError
>;

export type InterpreterResultWithoutToolCalls<A extends Agent<any, any, any, any>> =
  InterpreterResult<A, undefined>;

export type JsonFixResponse = { success: true; fixed: any } | { success: false };

export type AutofixJsonFn = (badJson: string, signal: AbortSignal) => Promise<JsonFixResponse>;

export type InterpreterSuccessData<A extends Agent<any, any, any, any>> = {
  output: AssistantMessage<A["tools"]>;
  curl: string;
  headers: Headers;
  usage: InterpreterUsage;
};

type InterpreterParamsBase<A extends Agent<any, any, any, any>, Backend> = {
  systemPrompt?: () => Promise<string>;
  model: Omit<ExecutionModel<unknown>, "countTokens">;
  backend: Backend;
  irs: Array<CompilerIR<A>>;
  abortSignal: AbortSignal;
  transport: Transport;
  autofixJson?: AutofixJsonFn;
};

export type InterpreterParams<
  A extends Agent<any, any, any, any>,
  Backend,
  Tools extends Partial<OwnToolRegistry<A>> | undefined = undefined,
> = InterpreterParamsBase<A, Backend> & {
  onTokens: (t: string, type: InterpreterTokenType<Tools>) => Promise<void>;
  tools?: Tools;
};

export type InterpreterParamsWithoutTools<
  A extends Agent<any, any, any, any>,
  Backend,
> = InterpreterParamsBase<A, Backend> & {
  onTokens: (t: string, type: InterpreterTokenType<undefined>) => Promise<void>;
  tools?: undefined;
};

export type InterpreterParamsWithTools<
  A extends Agent<any, any, any, any>,
  Backend,
  Tools extends Partial<OwnToolRegistry<A>> = Partial<OwnToolRegistry<A>>,
> = InterpreterParamsBase<A, Backend> & {
  onTokens: (t: string, type: "reasoning" | "content" | "tool") => Promise<void>;
  tools: Tools;
};

export type InterpreterParamsImplementation<A extends Agent<any, any, any, any>, Backend> =
  | InterpreterParamsWithoutTools<A, Backend>
  | InterpreterParamsWithTools<A, Backend>;

const interpreterFinished = Symbol("interpreterFinished");
type InterpreterFinishedData<A extends Agent<any, any, any, any>> = InterpreterSuccessData<A> & {
  readonly [interpreterFinished]: true;
};
type InterpreterImplementationResult<A extends Agent<any, any, any, any>> = Result<
  InterpreterFinishedData<A>,
  InterpreterError
>;

export function interpreterParamsHaveTools<A extends Agent<any, any, any, any>, Backend>(
  params: InterpreterParamsImplementation<A, Backend>,
): params is InterpreterParamsWithTools<A, Backend> {
  return params.tools !== undefined;
}

export type InterpreterImplementationParams<A extends Agent<any, any, any, any>, Backend> = Omit<
  InterpreterParamsImplementation<A, Backend>,
  "onTokens"
> & {
  onTokens: (t: string, type: "reasoning" | "content" | "tool") => Promise<void>;
  finish: (args: {
    curl: string;
    headers: Headers;
    usage: InterpreterUsage;
    abortedOutput: AssistantMessage<A["tools"]>;
    parsedOutput: () => AssistantMessage<A["tools"]> | Promise<AssistantMessage<A["tools"]>>;
  }) => Promise<InterpreterImplementationResult<A>>;
};

type InterpreterImplementation<Backend> = <A extends Agent<any, any, any, any>>(
  params: InterpreterImplementationParams<A, Backend>,
) => Promise<InterpreterImplementationResult<A>>;

function interpreterSuccess<A extends Agent<any, any, any, any>, Backend>(
  params: InterpreterParamsImplementation<A, Backend>,
  data: InterpreterSuccessData<A>,
): InterpreterResult<A, undefined> | InterpreterResult<A> {
  if (
    !interpreterParamsHaveTools(params) &&
    data.output.toolCalls &&
    data.output.toolCalls.length > 0
  ) {
    return err(unexpectedToolCallError(data.curl, data.usage, data.headers));
  }

  if (!interpreterParamsHaveTools(params)) {
    const { toolCalls: _toolCalls, ...output } = data.output;
    return ok({
      ...data,
      output,
    });
  }

  return ok(data);
}

export type Interpreter<Backend> = <
  A extends Agent<any, any, any, any>,
  Tools extends Partial<OwnToolRegistry<A>> | undefined = undefined,
>(
  params: InterpreterParams<A, Backend, Tools>,
) => Promise<InterpreterResult<A, Tools>>;

// defineInterpreter keeps the "were tools offered?" bookkeeping local to libocto's interpreters. An
// interpreter gets a broad token callback that it can call with any provider event, plus a
// finish(...) callback that wraps final assistant construction. If a provider emits tool tokens when
// the caller did not supply tools, finish(...) returns an unexpected-tool-call error before running
// the parsedOutput callback, so interpreters do not need to duplicate that guard around every tool
// parsing path. finish(...) also skips the parsedOutput callback after aborts, because interpreter
// parsedOutput callbacks are where expensive or invalid-on-abort tool parsing usually happens.
export function defineInterpreter<Backend>(
  implementation: InterpreterImplementation<Backend>,
): Interpreter<Backend> {
  async function interpreter<A extends Agent<any, any, any, any>>(
    params: InterpreterParamsWithoutTools<A, Backend>,
  ): Promise<InterpreterResult<A, undefined>>;
  async function interpreter<A extends Agent<any, any, any, any>>(
    params: InterpreterParamsWithTools<A, Backend>,
  ): Promise<InterpreterResult<A>>;
  async function interpreter<A extends Agent<any, any, any, any>>(
    params: InterpreterParamsImplementation<A, Backend>,
  ): Promise<InterpreterResult<A, undefined> | InterpreterResult<A>> {
    let unexpectedToolCall = false;
    const onTokens: InterpreterImplementationParams<A, Backend>["onTokens"] = async (
      tokens,
      type,
    ) => {
      if (type === "tool") {
        if (!interpreterParamsHaveTools(params)) {
          unexpectedToolCall = true;
          return;
        }
        if (tokens === "") return;
        await params.onTokens(tokens, type);
        return;
      }

      await params.onTokens(tokens, type);
    };

    const finish: InterpreterImplementationParams<A, Backend>["finish"] = async ({
      curl,
      headers,
      usage,
      abortedOutput,
      parsedOutput,
    }) => {
      if (unexpectedToolCall) return err(unexpectedToolCallError(curl, usage, headers));
      const assistantMessage = params.abortSignal.aborted ? abortedOutput : await parsedOutput();
      return ok({
        output: assistantMessage,
        curl,
        headers,
        usage,
        [interpreterFinished]: true,
      });
    };

    const interpreted = await implementation({
      ...params,
      onTokens,
      finish,
    });
    if (!interpreted.success) return interpreted;
    return interpreterSuccess(params, interpreted.data);
  }

  return interpreter;
}
