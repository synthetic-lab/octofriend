import { err, ok, type Result } from "../result.ts";
import type { Agent, AssistantMessage, LoweredIR, OwnToolRegistry } from "../llm-ir.ts";
import type { ToolMap } from "../toolkits/tool-def.ts";
import { Transport } from "../transport.ts";
import type { ExecutionModel } from "../execution.ts";
import type { MultimodalConfig } from "../modalities.ts";

export type CompilerIR<A extends Agent<any, any, any, any>> = LoweredIR<A["tools"]>;

/*
 * The compile half of a protocol: IR in, a provider-native request body out, with no execution.
 *
 * Each provider's compiler module owns the whole body — messages, tool schemas, model options,
 * streaming flags — so a caller can hand the result to their own transport (an HTTP client, or a
 * queue of chat-completions-shaped jobs) instead of libocto's protocol. Compilers live below
 * protocol implementations: the shipped protocols import them, never the other way around.
 */

// The minimum a compiler needs to know about the model: the wire name, and which modalities it can
// render. ExecutionModel satisfies this, so protocols can pass their model straight through.
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

export type ProtocolTokenType<Tools = unknown> = [Tools] extends [undefined]
  ? "reasoning" | "content"
  : "reasoning" | "content" | "tool";

export type ProtocolModality = "text" | "vision";
export type ProtocolModalities = readonly ProtocolModality[];

export type ProtocolUsage = {
  input: {
    cached: number;
    uncached: number;
    total: number;
  };
  output: number;
};

export function protocolUsage(
  inputTotal: number,
  output: number,
  cached: number = 0,
): ProtocolUsage {
  return {
    input: {
      cached,
      uncached: Math.max(0, inputTotal - cached),
      total: inputTotal,
    },
    output,
  };
}

export function protocolUsageHasTokens(usage: ProtocolUsage): boolean {
  return usage.input.total !== 0 || usage.output !== 0;
}

export type ProtocolError =
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
      usage: ProtocolUsage;
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
      usage: ProtocolUsage;
      headers: Headers;
    };

export function unexpectedToolCallError(
  curl: string,
  usage: ProtocolUsage,
  headers: Headers,
): ProtocolError {
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

export type ProtocolResultData<A extends Agent<any, any, any, any>, Tools> = {
  output: AssistantMessageForTools<A, Tools>;
  curl: string;
  headers: Headers;
  usage: ProtocolUsage;
};

export type ProtocolResult<A extends Agent<any, any, any, any>, Tools = unknown> = Result<
  ProtocolResultData<A, Tools>,
  ProtocolError
>;

export type ProtocolResultWithoutToolCalls<A extends Agent<any, any, any, any>> = ProtocolResult<
  A,
  undefined
>;

export type JsonFixResponse = { success: true; fixed: any } | { success: false };

export type AutofixJsonFn = (badJson: string, signal: AbortSignal) => Promise<JsonFixResponse>;

export type ProtocolSuccessData<A extends Agent<any, any, any, any>> = {
  output: AssistantMessage<A["tools"]>;
  curl: string;
  headers: Headers;
  usage: ProtocolUsage;
};

type ProtocolParamsBase<A extends Agent<any, any, any, any>, Backend> = {
  systemPrompt?: () => Promise<string>;
  model: Omit<ExecutionModel<unknown>, "countTokens">;
  backend: Backend;
  irs: Array<CompilerIR<A>>;
  abortSignal: AbortSignal;
  transport: Transport;
  autofixJson?: AutofixJsonFn;
};

export type ProtocolParams<
  A extends Agent<any, any, any, any>,
  Backend,
  Tools extends Partial<OwnToolRegistry<A>> | undefined = undefined,
> = ProtocolParamsBase<A, Backend> & {
  onTokens: (t: string, type: ProtocolTokenType<Tools>) => Promise<void>;
  tools?: Tools;
};

export type ProtocolParamsWithoutTools<
  A extends Agent<any, any, any, any>,
  Backend,
> = ProtocolParamsBase<A, Backend> & {
  onTokens: (t: string, type: ProtocolTokenType<undefined>) => Promise<void>;
  tools?: undefined;
};

export type ProtocolParamsWithTools<
  A extends Agent<any, any, any, any>,
  Backend,
  Tools extends Partial<OwnToolRegistry<A>> = Partial<OwnToolRegistry<A>>,
> = ProtocolParamsBase<A, Backend> & {
  onTokens: (t: string, type: "reasoning" | "content" | "tool") => Promise<void>;
  tools: Tools;
};

export type ProtocolParamsImplementation<A extends Agent<any, any, any, any>, Backend> =
  | ProtocolParamsWithoutTools<A, Backend>
  | ProtocolParamsWithTools<A, Backend>;

const protocolFinished = Symbol("protocolFinished");
type ProtocolFinishedData<A extends Agent<any, any, any, any>> = ProtocolSuccessData<A> & {
  readonly [protocolFinished]: true;
};
type ProtocolImplementationResult<A extends Agent<any, any, any, any>> = Result<
  ProtocolFinishedData<A>,
  ProtocolError
>;

export function protocolParamsHaveTools<A extends Agent<any, any, any, any>, Backend>(
  params: ProtocolParamsImplementation<A, Backend>,
): params is ProtocolParamsWithTools<A, Backend> {
  return params.tools !== undefined;
}

export type ProtocolImplementationParams<A extends Agent<any, any, any, any>, Backend> = Omit<
  ProtocolParamsImplementation<A, Backend>,
  "onTokens"
> & {
  onTokens: (t: string, type: "reasoning" | "content" | "tool") => Promise<void>;
  finish: (args: {
    curl: string;
    headers: Headers;
    usage: ProtocolUsage;
    abortedOutput: AssistantMessage<A["tools"]>;
    parsedOutput: () => AssistantMessage<A["tools"]> | Promise<AssistantMessage<A["tools"]>>;
  }) => Promise<ProtocolImplementationResult<A>>;
};

type ProtocolImplementation<Backend> = <A extends Agent<any, any, any, any>>(
  params: ProtocolImplementationParams<A, Backend>,
) => Promise<ProtocolImplementationResult<A>>;

function protocolSuccess<A extends Agent<any, any, any, any>, Backend>(
  params: ProtocolParamsImplementation<A, Backend>,
  data: ProtocolSuccessData<A>,
): ProtocolResult<A, undefined> | ProtocolResult<A> {
  if (
    !protocolParamsHaveTools(params) &&
    data.output.toolCalls &&
    data.output.toolCalls.length > 0
  ) {
    return err(unexpectedToolCallError(data.curl, data.usage, data.headers));
  }

  if (!protocolParamsHaveTools(params)) {
    const { toolCalls: _toolCalls, ...output } = data.output;
    return ok({
      ...data,
      output,
    });
  }

  return ok(data);
}

export type Protocol<Backend> = <
  A extends Agent<any, any, any, any>,
  Tools extends Partial<OwnToolRegistry<A>> | undefined = undefined,
>(
  params: ProtocolParams<A, Backend, Tools>,
) => Promise<ProtocolResult<A, Tools>>;

// defineProtocol keeps the "were tools offered?" bookkeeping local to libocto's protocol
// implementations. A protocol gets a broad token callback that it can call with any provider event,
// plus a finish(...) callback that wraps final assistant construction. If a provider emits tool
// tokens when the caller did not supply tools, finish(...) returns an unexpected-tool-call error
// before running the parsedOutput callback, so protocols do not need to duplicate that guard around
// every tool parsing path. finish(...) also skips the parsedOutput callback after aborts, because
// protocol parsedOutput callbacks are where expensive or invalid-on-abort tool parsing usually
// happens.
export function defineProtocol<Backend>(
  implementation: ProtocolImplementation<Backend>,
): Protocol<Backend> {
  async function protocol<A extends Agent<any, any, any, any>>(
    params: ProtocolParamsWithoutTools<A, Backend>,
  ): Promise<ProtocolResult<A, undefined>>;
  async function protocol<A extends Agent<any, any, any, any>>(
    params: ProtocolParamsWithTools<A, Backend>,
  ): Promise<ProtocolResult<A>>;
  async function protocol<A extends Agent<any, any, any, any>>(
    params: ProtocolParamsImplementation<A, Backend>,
  ): Promise<ProtocolResult<A, undefined> | ProtocolResult<A>> {
    let unexpectedToolCall = false;
    const onTokens: ProtocolImplementationParams<A, Backend>["onTokens"] = async (tokens, type) => {
      if (type === "tool") {
        if (!protocolParamsHaveTools(params)) {
          unexpectedToolCall = true;
          return;
        }
        if (tokens === "") return;
        await params.onTokens(tokens, type);
        return;
      }

      await params.onTokens(tokens, type);
    };

    const finish: ProtocolImplementationParams<A, Backend>["finish"] = async ({
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
        [protocolFinished]: true,
      });
    };

    const result = await implementation({
      ...params,
      onTokens,
      finish,
    });
    if (!result.success) return result;
    return protocolSuccess(params, result.data);
  }

  return protocol;
}
