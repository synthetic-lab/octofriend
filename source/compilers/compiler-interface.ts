import { ModelConfig } from "../config.ts";
import { AgentResult } from "../ir/llm-ir.ts";
import { WindowedIR } from "../ir/ir-windowing.ts";
import { Transport } from "../transports/transport-common.ts";
import { ToolDef } from "../tools/common.ts";
import { JsonFixResponse } from "../prompts/autofix-prompts.ts";

export type Compiler = ({
  model, apiKey, windowedIR, onTokens, abortSignal, transport, systemPrompt, autofixJson, tools
}: {
  systemPrompt?: () => Promise<string>,
  model: ModelConfig,
  apiKey: string,
  windowedIR: WindowedIR,
  onTokens: (t: string, type: "reasoning" | "content" | "tool") => any,
  abortSignal: AbortSignal,
  transport: Transport,
  autofixJson: (badJson: string, signal: AbortSignal) => Promise<JsonFixResponse>,
  tools?: Record<string, ToolDef<any>>,
}) => Promise<AgentResult>;
