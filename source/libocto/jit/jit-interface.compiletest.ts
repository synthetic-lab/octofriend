import type { Agent } from "../llm-ir.ts";
import type { Transport } from "../transport.ts";
import type {
  Interpreter,
  InterpreterImplementationParams,
  InterpreterResult,
  InterpreterResultWithoutToolCalls,
} from "./jit-interface.ts";
import { interpreterUsage, defineInterpreter } from "./jit-interface.ts";
import type { ExecutionModel } from "../execution.ts";

type ScratchBackend = {
  model: string;
};

type ScratchAgent = Agent<never, {}, {}, {}>;

const scratchInterpreter: Interpreter<ScratchBackend> = defineInterpreter(
  async <A extends Agent<any, any, any, any>>(
    params: InterpreterImplementationParams<A, ScratchBackend>,
  ) => {
    await params.onTokens("hello", "content");
    await params.onTokens("{}", "tool");

    return params.finish({
      curl: "",
      headers: new Headers(),
      usage: interpreterUsage(0, 0),
      abortedOutput: {
        role: "assistant",
        content: "hello",
        usage: interpreterUsage(0, 0),
      },
      parsedOutput: () => ({
        role: "assistant",
        content: "hello",
        usage: interpreterUsage(0, 0),
      }),
    });
  },
);

declare const abortSignal: AbortSignal;
declare const transport: Transport;
declare const model: Omit<ExecutionModel<unknown>, "countTokens">;
declare const backend: ScratchBackend;

const withoutTools = scratchInterpreter<ScratchAgent>({
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

withoutTools.then(compiled => {
  if (!compiled.success) return;

  const noToolCalls: undefined = compiled.data.output.toolCalls;
  void noToolCalls;
});

declare const toolCapableResult: InterpreterResult<ScratchAgent, { someTool: unknown }>;
declare const noToolsResult: InterpreterResultWithoutToolCalls<ScratchAgent>;

const defaultResultAcceptsToolCapable: InterpreterResult<ScratchAgent> = toolCapableResult;
const defaultResultAcceptsNoTools: InterpreterResult<ScratchAgent> = noToolsResult;

void defaultResultAcceptsToolCapable;
void defaultResultAcceptsNoTools;
