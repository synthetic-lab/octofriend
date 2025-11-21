import { runAnthropicAgent } from "./anthropic.ts";
import { runResponsesAgent } from "./responses.ts";
import { runAgent } from "./standard.ts";
import { AutoCompactConfig, Config, getModelFromConfig } from "../config.ts";
import { LlmIR, toLlmIR } from "../ir/llm-ir.ts";
import { applyContextWindow, countIRTokens } from "../ir/ir-windowing.ts";
import { Transport } from "../transports/transport-common.ts";
import { ActivityMode } from "../state.ts";
import { HistoryItem } from "../history.ts";

function shouldAutoCompactHistory(
  messages: LlmIR[],
  context: number,
  autoCompactSettings?: AutoCompactConfig,
): boolean {
  // TODO (steph): make return default to true once connected with app.tsx
  if (!autoCompactSettings?.enabled) return false;

  const contextThreshold = autoCompactSettings.contextThreshold;
  const maxAllowedTokens = Math.floor(context * contextThreshold);
  const currentTokens = countIRTokens(messages);

  return currentTokens >= maxAllowedTokens;
}

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

  let processedMessages = messages;
  let appliedCompaction = false;
  let compactSummary: string | undefined;

  // Apply compaction first if needed
  if (shouldAutoCompactHistory(messages, modelConfig.context, config.autoCompact)) {
    compactSummary = "[Conversation history compacted due to context limits]";
    appliedCompaction = true;
  }

  const windowedIR = applyContextWindow(processedMessages, modelConfig.context);

  return await run({
    config, modelOverride, windowedIR, onTokens, onActivity, abortSignal, transport, skipSystemPrompt, appliedCompaction, compactSummary
  });
}
