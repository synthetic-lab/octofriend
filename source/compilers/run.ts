import { runAnthropicAgent } from "./anthropic.ts";
import { runResponsesAgent } from "./responses.ts";
import { runAgent } from "./standard.ts";
import { Config, ModelConfig } from "../config.ts";
import { LlmIR } from "../ir/llm-ir.ts";
import { applyContextWindow } from "../ir/ir-windowing.ts";
import { Transport } from "../transports/transport-common.ts";
import { findMostRecentCompactionCheckpointIndex } from "./autocompact.ts";

export async function run({
  config, model, messages, onTokens, onAutofixJson, abortSignal, transport, systemPrompt
}: {
  model: ModelConfig,
  config: Config,
  messages: LlmIR[],
  onTokens: (t: string, type: "reasoning" | "content" | "tool") => any,
  onAutofixJson: (done: Promise<void>) => any,
  abortSignal: AbortSignal,
  transport: Transport,
  systemPrompt?: (appliedWindow: boolean) => Promise<string>,
}) {
  const runInternal = (() => {
    if(model.type == null || model.type === "standard") return runAgent;
    if(model.type === "openai-responses") return runResponsesAgent;
    const _: "anthropic" = model.type;
    return runAnthropicAgent;
  })();

  const checkpointIndex = findMostRecentCompactionCheckpointIndex(messages);
  const slicedMessages = messages.slice(checkpointIndex);

  const windowedIR = applyContextWindow(slicedMessages, model.context);
  const wrappedPrompt = systemPrompt == null ? systemPrompt : async () => {
    return systemPrompt(windowedIR.appliedWindow);
  };

  return await runInternal({
    model,
    config,
    windowedIR,
    onTokens,
    onAutofixJson,
    abortSignal,
    transport,
    systemPrompt: wrappedPrompt,
  });
}
