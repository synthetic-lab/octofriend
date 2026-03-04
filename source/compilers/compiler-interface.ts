import { ModelConfig } from "../config.ts";
import { AgentResult } from "../ir/llm-ir.ts";
import { QuotaData } from "../utils/quota.ts";
import { JsonFixResponse } from "../prompts/autofix-prompts.ts";
import { LlmIR } from "../ir/llm-ir.ts";
import { LoadedTools } from "../tools/index.ts";

export type Compiler = (params: {
  systemPrompt?: () => Promise<string>;
  model: ModelConfig;
  apiKey: string;
  irs: LlmIR[];
  onTokens: (t: string, type: "reasoning" | "content" | "tool") => any;
  onQuotaUpdated?: (quota: QuotaData) => void;
  abortSignal: AbortSignal;
  autofixJson: (badJson: string, signal: AbortSignal) => Promise<JsonFixResponse>;
  tools?: Partial<LoadedTools>;
}) => Promise<AgentResult>;
