import { Config, ModelConfig } from "../config.ts";
import {
  AgentResult
} from "../ir/llm-ir.ts";
import { WindowedIR } from "../ir/ir-windowing.ts";
import { Transport } from "../transports/transport-common.ts";

export type Compiler = ({
  model, config, windowedIR, onTokens, onAutofixJson, abortSignal, transport, systemPrompt
}: {
  systemPrompt?: () => Promise<string>,
  model: ModelConfig,
  config: Config,
  windowedIR: WindowedIR,
  onTokens: (t: string, type: "reasoning" | "content" | "tool") => any,
  onAutofixJson: (done: Promise<void>) => any,
  abortSignal: AbortSignal,
  transport: Transport,
}) => Promise<AgentResult>;
