import { ok } from "../result.ts";
import type { Agent } from "../llm-ir.ts";
import type { Transport } from "../../transports/transport-common.ts";
import type {
  Compiler,
  CompilerParamsImplementation,
  CompilerResult,
  CompilerResultWithoutToolCalls,
} from "./compiler-interface.ts";
import { compilerParamsHaveTools, compilerUsage, defineCompiler } from "./compiler-interface.ts";

type ScratchModel = {
  model: string;
};

type ScratchAgent = Agent<never, {}, {}>;

const scratchCompiler: Compiler<ScratchModel> = defineCompiler(
  async <A extends Agent<any, any, any>>(params: CompilerParamsImplementation<A, ScratchModel>) => {
    params.onTokens("hello", "content");

    if (compilerParamsHaveTools(params)) {
      params.onTokens("{}", "tool");
    } else {
      // @ts-expect-error Tool tokens are only legal after narrowing to the with-tools params.
      params.onTokens("{}", "tool");
    }

    return ok({
      output: {
        role: "assistant",
        content: "hello",
        usage: compilerUsage(0, 0),
      },
      curl: "",
      usage: compilerUsage(0, 0),
    });
  },
);

declare const abortSignal: AbortSignal;
declare const transport: Transport;
declare const model: ScratchModel;

const withoutTools = scratchCompiler<ScratchAgent>({
  model,
  irs: [],
  abortSignal,
  transport,
  onTokens: (_token, tokenType) => {
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

declare const toolCapableResult: CompilerResult<ScratchAgent, { someTool: unknown }>;
declare const noToolsResult: CompilerResultWithoutToolCalls<ScratchAgent>;

const defaultResultAcceptsToolCapable: CompilerResult<ScratchAgent> = toolCapableResult;
const defaultResultAcceptsNoTools: CompilerResult<ScratchAgent> = noToolsResult;

void defaultResultAcceptsToolCapable;
void defaultResultAcceptsNoTools;
