import { ModelConfig } from "../config.ts";
import type { Result } from "../result.ts";
import type { Agent, AssistantMessage, LoweredIR } from "../libocto/llm-ir.ts";
import type { LoadedTools } from "../libocto/tool-def.ts";
import { QuotaData } from "../utils/quota.ts";
import { JsonFixResponse } from "../prompts/autofix-prompts.ts";
import { Transport } from "../transports/transport-common.ts";

export type CompilerIR<A extends Agent<any, any, any>> = LoweredIR<A["tools"]>;

export type CompilerResult<A extends Agent<any, any, any>> = Result<
  {
    output: AssistantMessage<A["tools"]>;
    curl: string;
  },
  {
    requestError: string;
    curl: string;
  }
>;

export type CompilerParams<A extends Agent<any, any, any>> = {
  systemPrompt?: () => Promise<string>;
  model: ModelConfig;
  apiKey: string;
  irs: Array<CompilerIR<A>>;
  onTokens: (t: string, type: "reasoning" | "content" | "tool") => any;
  onQuotaUpdated?: (quota: QuotaData) => void;
  abortSignal: AbortSignal;
  transport: Transport;
  autofixJson: (badJson: string, signal: AbortSignal) => Promise<JsonFixResponse>;
  tools?: Partial<LoadedTools<A["tools"]>>;
};

export type Compiler = <A extends Agent<any, any, any>>(
  params: CompilerParams<A>,
) => Promise<CompilerResult<A>>;
