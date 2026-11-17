import type { Agent } from "../llm-ir.ts";
import type { Transport } from "../transport.ts";
import type {
  Protocol,
  ProtocolImplementationParams,
  ProtocolResult,
  ProtocolResultWithoutToolCalls,
} from "./protocol-interface.ts";
import { protocolUsage, defineProtocol } from "./protocol-interface.ts";
import type { ExecutionModel } from "../execution.ts";

type ScratchBackend = {
  model: string;
};

type ScratchAgent = Agent<never, {}, {}, {}>;

const scratchProtocol: Protocol<ScratchBackend> = defineProtocol(
  async <A extends Agent<any, any, any, any>>(
    params: ProtocolImplementationParams<A, ScratchBackend>,
  ) => {
    await params.onTokens("hello", "content");
    await params.onTokens("{}", "tool");

    return params.finish({
      curl: "",
      headers: new Headers(),
      usage: protocolUsage(0, 0),
      abortedOutput: {
        role: "assistant",
        content: "hello",
        usage: protocolUsage(0, 0),
      },
      parsedOutput: () => ({
        role: "assistant",
        content: "hello",
        usage: protocolUsage(0, 0),
      }),
    });
  },
);

declare const abortSignal: AbortSignal;
declare const transport: Transport;
declare const model: Omit<ExecutionModel<unknown>, "countTokens">;
declare const backend: ScratchBackend;

const withoutTools = scratchProtocol<ScratchAgent>({
  model,
  backend,
  irs: [],
  abortSignal,
  transport,
  onTokens: async (_token, tokenType) => {
    const validTokenType: "reasoning" | "content" = tokenType;
    void validTokenType;

    // @ts-expect-error Callers that do not pass tools cannot receive tool tokens.
    const invalidToolToken: "tool" = tokenType;
    void invalidToolToken;
  },
});

withoutTools.then(result => {
  if (!result.success) return;

  const noToolCalls: undefined = result.data.output.toolCalls;
  void noToolCalls;
});

declare const toolCapableResult: ProtocolResult<ScratchAgent, { someTool: unknown }>;
declare const noToolsResult: ProtocolResultWithoutToolCalls<ScratchAgent>;

const defaultResultAcceptsToolCapable: ProtocolResult<ScratchAgent> = toolCapableResult;
const defaultResultAcceptsNoTools: ProtocolResult<ScratchAgent> = noToolsResult;

void defaultResultAcceptsToolCapable;
void defaultResultAcceptsNoTools;
