import { err, ok, type Result } from "../result.ts";
import type { Agent, AssistantMessage, LoweredIR } from "../llm-ir.ts";
import type { LoadedTools, ToolMap } from "../tool-def.ts";
import { JsonFixResponse } from "../../prompts/autofix-prompts.ts";
import { Transport } from "../../transports/transport-common.ts";

export type CompilerIR<A extends Agent<any, any, any>> = LoweredIR<A["tools"]>;
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

type AssistantMessageForTools<A extends Agent<any, any, any>, Tools> = [Tools] extends [undefined]
  ? AssistantMessageWithoutToolCalls<A["tools"]>
  : AssistantMessage<A["tools"]>;

export type CompilerResultData<A extends Agent<any, any, any>, Tools> = {
  output: AssistantMessageForTools<A, Tools>;
  curl: string;
  headers: Headers;
  usage: CompilerUsage;
};

export type CompilerResult<A extends Agent<any, any, any>, Tools = unknown> = Result<
  CompilerResultData<A, Tools>,
  CompilerError
>;

export type CompilerResultWithoutToolCalls<A extends Agent<any, any, any>> = CompilerResult<
  A,
  undefined
>;

export type CompilerSuccessData<A extends Agent<any, any, any>> = {
  output: AssistantMessage<A["tools"]>;
  curl: string;
  headers: Headers;
  usage: CompilerUsage;
};

type CompilerParamsBase<A extends Agent<any, any, any>, Model> = {
  systemPrompt?: () => Promise<string>;
  model: Model;
  irs: Array<CompilerIR<A>>;
  abortSignal: AbortSignal;
  transport: Transport;
  autofixJson?: (badJson: string, signal: AbortSignal) => Promise<JsonFixResponse>;
};

export type CompilerParams<
  A extends Agent<any, any, any>,
  Model,
  Tools extends Partial<LoadedTools<A["tools"]>> | undefined = undefined,
> = CompilerParamsBase<A, Model> & {
  onTokens: (t: string, type: CompilerTokenType<Tools>) => any;
  tools?: Tools;
};

export type CompilerParamsWithoutTools<A extends Agent<any, any, any>, Model> = CompilerParamsBase<
  A,
  Model
> & {
  onTokens: (t: string, type: CompilerTokenType<undefined>) => any;
  tools?: undefined;
};

export type CompilerParamsWithTools<
  A extends Agent<any, any, any>,
  Model,
  Tools extends Partial<LoadedTools<A["tools"]>> = Partial<LoadedTools<A["tools"]>>,
> = CompilerParamsBase<A, Model> & {
  onTokens: (t: string, type: "reasoning" | "content" | "tool") => any;
  tools: Tools;
};

export type CompilerParamsImplementation<A extends Agent<any, any, any>, Model> =
  | CompilerParamsWithoutTools<A, Model>
  | CompilerParamsWithTools<A, Model>;

const compilerFinished = Symbol("compilerFinished");
type CompilerFinishedData<A extends Agent<any, any, any>> = CompilerSuccessData<A> & {
  readonly [compilerFinished]: true;
};
type CompilerImplementationResult<A extends Agent<any, any, any>> = Result<
  CompilerFinishedData<A>,
  CompilerError
>;

export function compilerParamsHaveTools<A extends Agent<any, any, any>, Model>(
  params: CompilerParamsImplementation<A, Model>,
): params is CompilerParamsWithTools<A, Model> {
  return params.tools !== undefined;
}

export type CompilerImplementationParams<A extends Agent<any, any, any>, Model> = Omit<
  CompilerParamsImplementation<A, Model>,
  "onTokens"
> & {
  onTokens: (t: string, type: "reasoning" | "content" | "tool") => any;
  finish: (args: {
    curl: string;
    headers: Headers;
    usage: CompilerUsage;
    abortedOutput: AssistantMessage<A["tools"]>;
    parsedOutput: () => AssistantMessage<A["tools"]> | Promise<AssistantMessage<A["tools"]>>;
  }) => Promise<CompilerImplementationResult<A>>;
};

type CompilerImplementation<Model> = <A extends Agent<any, any, any>>(
  params: CompilerImplementationParams<A, Model>,
) => Promise<CompilerImplementationResult<A>>;

function compilerSuccess<A extends Agent<any, any, any>, Model>(
  params: CompilerParamsImplementation<A, Model>,
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

export type Compiler<Model> = <
  A extends Agent<any, any, any>,
  Tools extends Partial<LoadedTools<A["tools"]>> | undefined = undefined,
>(
  params: CompilerParams<A, Model, Tools>,
) => Promise<CompilerResult<A, Tools>>;

// defineCompiler keeps the "were tools offered?" bookkeeping local to libocto. Concrete compiler
// implementations get a broad token callback that they can call with any provider event, plus a
// finish(...) callback that wraps final assistant construction. If a provider emits tool tokens when
// the caller did not supply tools, finish(...) returns an unexpected-tool-call error before running
// the parsedOutput callback, so compiler implementations do not need to duplicate that guard around
// every tool parsing path. finish(...) also skips the parsedOutput callback after aborts, because
// compiler parsedOutput callbacks are where expensive or invalid-on-abort tool parsing usually
// happens.
export function defineCompiler<Model>(
  implementation: CompilerImplementation<Model>,
): Compiler<Model> {
  async function compiler<A extends Agent<any, any, any>>(
    params: CompilerParamsWithoutTools<A, Model>,
  ): Promise<CompilerResult<A, undefined>>;
  async function compiler<A extends Agent<any, any, any>>(
    params: CompilerParamsWithTools<A, Model>,
  ): Promise<CompilerResult<A>>;
  async function compiler<A extends Agent<any, any, any>>(
    params: CompilerParamsImplementation<A, Model>,
  ): Promise<CompilerResult<A, undefined> | CompilerResult<A>> {
    let unexpectedToolCall = false;
    const onTokens: CompilerImplementationParams<A, Model>["onTokens"] = (tokens, type) => {
      if (type === "tool") {
        if (!compilerParamsHaveTools(params)) {
          unexpectedToolCall = true;
          return;
        }
        if (tokens === "") return;
        params.onTokens(tokens, type);
        return;
      }

      params.onTokens(tokens, type);
    };

    const finish: CompilerImplementationParams<A, Model>["finish"] = async ({
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
