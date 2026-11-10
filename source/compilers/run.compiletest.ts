import type {
  CompilerResult,
  CompilerResultWithoutToolCalls,
  CompilerTokenType,
  JsonFixResponse,
} from "../libocto/compilers/compiler-interface.ts";
import type { LoweredIR } from "../libocto/llm-ir.ts";
import type { Transport } from "../libocto/transport.ts";
import type { LoadedTools as GenericLoadedTools } from "../libocto/tool-def.ts";
import { octoAgent } from "../ir/octo-ir.ts";
import { run } from "./run.ts";
import type { ModelData } from "./run.ts";

function expectType<T>(_: T) {}

type LoadedTools = GenericLoadedTools<typeof octoAgent.tools>;

declare const modelData: ModelData;
declare const messages: Array<LoweredIR<typeof octoAgent.tools>>;
declare const signal: AbortSignal;
declare const transport: Transport;
declare const autofixJson: (badJson: string, signal: AbortSignal) => Promise<JsonFixResponse>;
declare const tools: Partial<LoadedTools>;

const noToolsResult = run<typeof octoAgent>({
  model: modelData,
  irs: messages,
  abortSignal: signal,
  transport,
  autofixJson,
  onTokens: async (_tokens, type) => {
    expectType<"reasoning" | "content">(type);
    // @ts-expect-error no tools were provided, so no tool-token stream is possible.
    expectType<"tool">(type);
  },
});

expectType<Promise<CompilerResultWithoutToolCalls<typeof octoAgent>>>(noToolsResult);

noToolsResult.then(result => {
  if (!result.success) return;
  expectType<undefined>(result.data.output.toolCalls);
});

const withToolsResult = run<typeof octoAgent, Partial<LoadedTools>>({
  model: modelData,
  irs: messages,
  abortSignal: signal,
  transport,
  autofixJson,
  tools,
  onTokens: async (_tokens, type) => {
    expectType<CompilerTokenType<LoadedTools>>(type);
  },
});

expectType<Promise<CompilerResult<typeof octoAgent, Partial<LoadedTools>>>>(withToolsResult);

run<typeof octoAgent>({
  model: modelData,
  irs: messages,
  abortSignal: signal,
  transport,
  autofixJson,
  // @ts-expect-error no-tools callbacks cannot require only tool tokens.
  onTokens: async (_tokens, _type: "tool") => {},
});
