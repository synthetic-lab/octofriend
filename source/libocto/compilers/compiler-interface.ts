import { err, ok, type Result } from "../result.ts";
import type { Agent, AssistantMessage, LoweredIR } from "../llm-ir.ts";
import type { LoadedTools, ToolMap } from "../tools/tool-def.ts";
import { Transport } from "../transport.ts";
import type { ExecutionModel } from "../execution.ts";

export type CompilerIR<A extends Agent<any, any, any, any>> = LoweredIR<A["tools"]>;
export type CompilerTokenType<Tools = unknown> = [Tools] extends [undefined]
  ? "reasoning" | "content"
  : "reasoning" | "content" | "tool";

export type CompilerModality = "text" | "vision";
export type CompilerModalities = readonly CompilerModality[];

export type CompilerUsage = {
  input: {
    cached: number;
    uncached: number;
    total: number;
  };
  output: number;
};

export function compilerUsage(
  inputTotal: number,
  output: number,
  cached: number = 0,
): CompilerUsage {
  return {
    input: {
      cached,
      uncached: Math.max(0, inputTotal - cached),
      total: inputTotal,
    },
    output,
  };
}

export function compilerUsageHasTokens(usage: CompilerUsage): boolean {
  return usage.input.total !== 0 || usage.output !== 0;
}

export type CompilerError =
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
      usage: CompilerUsage;
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
      usage: CompilerUsage;
      headers: Headers;
    };

export function unexpectedToolCallError(
  curl: string,
  usage: CompilerUsage,
  headers: Headers,
): CompilerError {
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

export type CompilerResultData<A extends Agent<any, any, any, any>, Tools> = {
  output: AssistantMessageForTools<A, Tools>;
  curl: string;
  headers: Headers;
  usage: CompilerUsage;
};

export type CompilerResult<A extends Agent<any, any, any, any>, Tools = unknown> = Result<
  CompilerResultData<A, Tools>,
  CompilerError
>;

export type CompilerResultWithoutToolCalls<A extends Agent<any, any, any, any>> = CompilerResult<
  A,
  undefined
>;

export type JsonFixResponse = { success: true; fixed: any } | { success: false };

export type AutofixJsonFn = (badJson: string, signal: AbortSignal) => Promise<JsonFixResponse>;

export type CompilerSuccessData<A extends Agent<any, any, any, any>> = {
  output: AssistantMessage<A["tools"]>;
  curl: string;
  headers: Headers;
  usage: CompilerUsage;
};

type CompilerParamsBase<A extends Agent<any, any, any, any>, Backend> = {
  systemPrompt?: () => Promise<string>;
  model: Omit<ExecutionModel<unknown>, "countTokens">;
  backend: Backend;
  irs: Array<CompilerIR<A>>;
  abortSignal: AbortSignal;
  transport: Transport;
  autofixJson?: AutofixJsonFn;
};

export type CompilerParams<
  A extends Agent<any, any, any, any>,
  Backend,
  Tools extends Partial<LoadedTools<A["tools"]>> | undefined = undefined,
> = CompilerParamsBase<A, Backend> & {
  onTokens: (t: string, type: CompilerTokenType<Tools>) => Promise<void>;
  tools?: Tools;
};

export type CompilerParamsWithoutTools<
  A extends Agent<any, any, any, any>,
  Backend,
> = CompilerParamsBase<A, Backend> & {
  onTokens: (t: string, type: CompilerTokenType<undefined>) => Promise<void>;
  tools?: undefined;
};

export type CompilerParamsWithTools<
  A extends Agent<any, any, any, any>,
  Backend,
  Tools extends Partial<LoadedTools<A["tools"]>> = Partial<LoadedTools<A["tools"]>>,
> = CompilerParamsBase<A, Backend> & {
  onTokens: (t: string, type: "reasoning" | "content" | "tool") => Promise<void>;
  tools: Tools;
};

export type CompilerParamsImplementation<A extends Agent<any, any, any, any>, Backend> =
  | CompilerParamsWithoutTools<A, Backend>
  | CompilerParamsWithTools<A, Backend>;

const compilerFinished = Symbol("compilerFinished");
type CompilerFinishedData<A extends Agent<any, any, any, any>> = CompilerSuccessData<A> & {
  readonly [compilerFinished]: true;
};
type CompilerImplementationResult<A extends Agent<any, any, any, any>> = Result<
  CompilerFinishedData<A>,
  CompilerError
>;

export function compilerParamsHaveTools<A extends Agent<any, any, any, any>, Backend>(
  params: CompilerParamsImplementation<A, Backend>,
): params is CompilerParamsWithTools<A, Backend> {
  return params.tools !== undefined;
}

export type CompilerImplementationParams<A extends Agent<any, any, any, any>, Backend> = Omit<
  CompilerParamsImplementation<A, Backend>,
  "onTokens"
> & {
  onTokens: (t: string, type: "reasoning" | "content" | "tool") => Promise<void>;
  finish: (args: {
    curl: string;
    headers: Headers;
    usage: CompilerUsage;
    abortedOutput: AssistantMessage<A["tools"]>;
    parsedOutput: () => AssistantMessage<A["tools"]> | Promise<AssistantMessage<A["tools"]>>;
  }) => Promise<CompilerImplementationResult<A>>;
};

type CompilerImplementation<Backend> = <A extends Agent<any, any, any, any>>(
  params: CompilerImplementationParams<A, Backend>,
) => Promise<CompilerImplementationResult<A>>;

function compilerSuccess<A extends Agent<any, any, any, any>, Backend>(
  params: CompilerParamsImplementation<A, Backend>,
  data: CompilerSuccessData<A>,
): CompilerResult<A, undefined> | CompilerResult<A> {
  if (
    !compilerParamsHaveTools(params) &&
    data.output.toolCalls &&
    data.output.toolCalls.length > 0
  ) {
    return err(unexpectedToolCallError(data.curl, data.usage, data.headers));
  }

  if (!compilerParamsHaveTools(params)) {
    const { toolCalls: _toolCalls, ...output } = data.output;
    return ok({
      ...data,
      output,
    });
  }

  return ok(data);
}

export type Compiler<Backend> = <
  A extends Agent<any, any, any, any>,
  Tools extends Partial<LoadedTools<A["tools"]>> | undefined = undefined,
>(
  params: CompilerParams<A, Backend, Tools>,
) => Promise<CompilerResult<A, Tools>>;

// defineCompiler keeps the "were tools offered?" bookkeeping local to libocto. Concrete compiler
// implementations get a broad token callback that they can call with any provider event, plus a
// finish(...) callback that wraps final assistant construction. If a provider emits tool tokens when
// the caller did not supply tools, finish(...) returns an unexpected-tool-call error before running
// the parsedOutput callback, so compiler implementations do not need to duplicate that guard around
// every tool parsing path. finish(...) also skips the parsedOutput callback after aborts, because
// compiler parsedOutput callbacks are where expensive or invalid-on-abort tool parsing usually
// happens.
export function defineCompiler<Backend>(
  implementation: CompilerImplementation<Backend>,
): Compiler<Backend> {
  async function compiler<A extends Agent<any, any, any, any>>(
    params: CompilerParamsWithoutTools<A, Backend>,
  ): Promise<CompilerResult<A, undefined>>;
  async function compiler<A extends Agent<any, any, any, any>>(
    params: CompilerParamsWithTools<A, Backend>,
  ): Promise<CompilerResult<A>>;
  async function compiler<A extends Agent<any, any, any, any>>(
    params: CompilerParamsImplementation<A, Backend>,
  ): Promise<CompilerResult<A, undefined> | CompilerResult<A>> {
    let unexpectedToolCall = false;
    const onTokens: CompilerImplementationParams<A, Backend>["onTokens"] = async (tokens, type) => {
      if (type === "tool") {
        if (!compilerParamsHaveTools(params)) {
          unexpectedToolCall = true;
          return;
        }
        if (tokens === "") return;
        await params.onTokens(tokens, type);
        return;
      }

      await params.onTokens(tokens, type);
    };

    const finish: CompilerImplementationParams<A, Backend>["finish"] = async ({
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
        [compilerFinished]: true,
      });
    };

    const compiled = await implementation({
      ...params,
      onTokens,
      finish,
    });
    if (!compiled.success) return compiled;
    return compilerSuccess(params, compiled.data);
  }

  return compiler;
}
