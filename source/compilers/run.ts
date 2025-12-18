import { runAnthropicAgent } from "./anthropic.ts";
import { runResponsesAgent } from "./responses.ts";
import { runAgent } from "./standard.ts";
import { Config, getModelFromConfig } from "../config.ts";
import { LlmIR, AgentResult } from "../ir/llm-ir.ts";
import { applyContextWindow, WindowedIR } from "../ir/ir-windowing.ts";
import { Transport } from "../transports/transport-common.ts";
import { findMostRecentCompactionCheckpointIndex } from "./autocompact.ts";

export async function run({
  config, modelOverride, messages, onTokens, onAutofixJson, abortSignal, transport, skipSystemPrompt
}: {
  config: Config,
  modelOverride: string | null,
  messages: LlmIR[],
  onTokens: (t: string, type: "reasoning" | "content" | "tool") => any,
  onAutofixJson: (done: Promise<void>) => any,
  abortSignal: AbortSignal,
  transport: Transport,
  skipSystemPrompt?: boolean,
}) {
  const modelConfig = getModelFromConfig(config, modelOverride);
  const runInternal = (() => {
    if(modelConfig.type == null || modelConfig.type === "standard") return runAgent;
    if(modelConfig.type === "openai-responses") return runResponsesAgent;
    const _: "anthropic" = modelConfig.type;
    return runAnthropicAgent;
  })();

  const checkpointIndex = findMostRecentCompactionCheckpointIndex(messages);
  const slicedMessages = messages.slice(checkpointIndex);

  const windowedIR = applyContextWindow(slicedMessages, modelConfig.context);

  return await runInternal({
    config,
    modelOverride,
    windowedIR,
    onTokens,
    onAutofixJson,
    abortSignal,
    transport,
    skipSystemPrompt,
  });
}