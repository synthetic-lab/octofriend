import type {
  CompilerResult,
  CompilerResultWithoutToolCalls,
  CompilerTokenType,
} from "../libocto/compilers/compiler-interface.ts";
import type { LoweredIR } from "../libocto/llm-ir.ts";
import type { JsonFixResponse } from "../prompts/autofix-prompts.ts";
import type { Transport } from "../transports/transport-common.ts";
import type { LoadedTools } from "../tools/index.ts";
import type toolMap from "../tools/tool-defs/index.ts";
import { octoAgent } from "../ir/octo-ir.ts";
import { run } from "./run.ts";
import type { RunModel } from "./run.ts";

function expectType<T>(_: T) {}

declare const modelData: RunModel;
declare const messages: Array<LoweredIR<typeof toolMap>>;
declare const signal: AbortSignal;
declare const transport: Transport;
declare const autofixJson: (badJson: string, signal: AbortSignal) => Promise<JsonFixResponse>;
declare const tools: Partial<LoadedTools>;

const noToolsResult = run({
  modelData,
  messages,
  abortSignal: signal,
  transport,
  autofixJson,
  handlers: {
    onTokens: (_tokens, type) => {
      expectType<"reasoning" | "content">(type);
      // @ts-expect-error no tools were provided, so no tool-token stream is possible.
      expectType<"tool">(type);
    },
    onAutofixJson: () => {},
  },
});

expectType<Promise<CompilerResultWithoutToolCalls<typeof octoAgent>>>(noToolsResult);

noToolsResult.then(result => {
  if (!result.success) return;
  expectType<undefined>(result.data.output.toolCalls);
});

const withToolsResult = run({
  modelData,
  messages,
  abortSignal: signal,
  transport,
  autofixJson,
  tools,
  handlers: {
    onTokens: (_tokens, type) => {
      expectType<CompilerTokenType<LoadedTools>>(type);
    },
    onAutofixJson: () => {},
  },
});

expectType<Promise<CompilerResult<typeof octoAgent, Partial<LoadedTools>>>>(withToolsResult);

run({
  modelData,
  messages,
  abortSignal: signal,
  transport,
  autofixJson,
  handlers: {
    // @ts-expect-error no-tools callbacks cannot require only tool tokens.
    onTokens: (_tokens, _type: "tool") => {},
    onAutofixJson: () => {},
  },
});
