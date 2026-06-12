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
      type: "request-error";
      requestError: string;
      curl: string;
    }
  | {
      type: "stream-error";
      requestError: string;
      curl: string;
      usage: CompilerUsage;
    }
  | {
      type: "payment-error";
      requestError: string;
      curl: string;
    }
  | {
      type: "rate-limit-error";
      requestError: string;
      curl: string;
    }
  | {
      type: "unexpected-tool-call";
      requestError: string;
      curl: string;
      usage: CompilerUsage;
    };

export function unexpectedToolCallError(curl: string, usage: CompilerUsage): CompilerError {
  return {
    type: "unexpected-tool-call",
    requestError: "Model returned tool calls even though no tools were provided.",
    curl,
    usage,
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
  headers?: Headers;
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
  headers?: Headers;
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

export type CompilerImplementationResult<A extends Agent<any, any, any>> = Result<
  CompilerSuccessData<A>,
  CompilerError
>;

export type CompilerImplementation<Model> = <A extends Agent<any, any, any>>(
  params: CompilerParamsImplementation<A, Model>,
) => Promise<CompilerImplementationResult<A>>;

export function compilerParamsHaveTools<A extends Agent<any, any, any>, Model>(
  params: CompilerParamsImplementation<A, Model>,
): params is CompilerParamsWithTools<A, Model> {
  return params.tools !== undefined;
}

function compilerSuccess<A extends Agent<any, any, any>, Model>(
  params: CompilerParamsImplementation<A, Model>,
  data: CompilerSuccessData<A>,
): CompilerResult<A, undefined> | CompilerResult<A> {
  if (
    !compilerParamsHaveTools(params) &&
    data.output.toolCalls &&
    data.output.toolCalls.length > 0
  ) {
    return err(unexpectedToolCallError(data.curl, data.usage));
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

// Compiler implementations are easiest to write against the concrete implementation union:
// either tools are present and tool tokens may be emitted, or tools are absent and they may not.
// Callers want a more precise API than that union, though: if they omit tools, the result should
// not expose `toolCalls`, and their token callback should never receive `"tool"`.
//
// defineCompiler keeps that split local to libocto. Compiler authors return ordinary
// tool-capable success data, and this wrapper adapts it to the public conditional Compiler type.
// If an SDK reports a tool call even though the caller supplied no tools, we surface the existing
// unexpected-tool-call error instead of returning an impossible no-tools assistant message.
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
    const compiled = await implementation(params);
    if (!compiled.success) return compiled;
    return compilerSuccess(params, compiled.data);
  }

  return compiler;
}
