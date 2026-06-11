import type { Result } from "../result.ts";
import type { Agent, AssistantMessage, LoweredIR } from "../llm-ir.ts";
import type { LoadedTools } from "../tool-def.ts";
import { JsonFixResponse } from "../../prompts/autofix-prompts.ts";
import { Transport } from "../../transports/transport-common.ts";

export type CompilerIR<A extends Agent<any, any, any>> = LoweredIR<A["tools"]>;

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
    };

export type CompilerResult<A extends Agent<any, any, any>> = Result<
  {
    output: AssistantMessage<A["tools"]>;
    curl: string;
    headers?: Headers;
    usage: CompilerUsage;
  },
  CompilerError
>;

export type CompilerParams<A extends Agent<any, any, any>, Model> = {
  systemPrompt?: () => Promise<string>;
  model: Model;
  irs: Array<CompilerIR<A>>;
  onTokens: (t: string, type: "reasoning" | "content" | "tool") => any;
  abortSignal: AbortSignal;
  transport: Transport;
  autofixJson?: (badJson: string, signal: AbortSignal) => Promise<JsonFixResponse>;
  tools?: Partial<LoadedTools<A["tools"]>>;
};

export type Compiler<Model> = <A extends Agent<any, any, any>>(
  params: CompilerParams<A, Model>,
) => Promise<CompilerResult<A>>;
