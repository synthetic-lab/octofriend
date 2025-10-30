import { runAnthropicAgent } from "./anthropic.ts";
import { runResponsesAgent } from "./responses.ts";
import { runAgent } from "./standard.ts";
import { Config, getModelFromConfig } from "../config.ts";
import { LlmIR } from "../ir/llm-ir.ts";
import { applyContextWindow } from "../ir/ir-windowing.ts";
import { Transport } from "../transports/transport-common.ts";
import { ActivityMode } from "../state.ts";

export async function run({
  config, modelOverride, messages, onTokens, onActivity, abortSignal, transport, skipSystemPrompt
}: {
  config: Config,
  modelOverride: string | null,
  messages: LlmIR[],
  onTokens: (t: string, type: "reasoning" | "content" | "tool") => any,
  onActivity: (activity: ActivityMode, done: Promise<void>) => any,
  abortSignal: AbortSignal,
  transport: Transport,
  skipSystemPrompt?: boolean,
}) {
  const modelConfig = getModelFromConfig(config, modelOverride);
  const run = (() => {
    if(modelConfig.type == null || modelConfig.type === "standard") return runAgent;
    if(modelConfig.type === "openai-responses") return runResponsesAgent;
    const _: "anthropic" = modelConfig.type;
    return runAnthropicAgent;
  })();

  const windowedIR = applyContextWindow(messages, modelConfig.context);

  return await run({
    config, modelOverride, windowedIR, onTokens, onActivity, abortSignal, transport, skipSystemPrompt
  });
}
