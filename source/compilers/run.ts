import { runAnthropicAgent } from "./anthropic.ts";
import { runResponsesAgent } from "./responses.ts";
import { runAgent } from "./standard.ts";
import { AutoCompactConfig, Config, getModelFromConfig } from "../config.ts";
import { LlmIR, toLlmIR, OutputIR, outputToHistory, AgentResult } from "../ir/llm-ir.ts";
import { applyContextWindow, countIRTokens, WindowedIR } from "../ir/ir-windowing.ts";
import { Transport } from "../transports/transport-common.ts";

import { formatMessagesForSummary, processCompactedHistory } from "./autocompact.ts";

function shouldAutoCompactHistory(
  messages: LlmIR[],
  context: number,
  autoCompactSettings?: AutoCompactConfig,
): boolean {
  if (!autoCompactSettings?.enabled) return false;

  const contextThreshold = autoCompactSettings.contextThreshold;

  if (contextThreshold <= 0 || contextThreshold > 1) {
    // TODO (steph): surface error that contextThreshold must be between 0 and 1.
  }
  const maxAllowedTokens = Math.floor(context * contextThreshold);
  const currentTokens = countIRTokens(messages);

  return currentTokens >= maxAllowedTokens;
}

function findMostRecentCheckpointIndex(messages: LlmIR[]): number {
  // Loop backwards through messages to find the most recent compaction checkpoint
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "compaction-checkpoint") {
      return i;
    }
  }
  return 0; // If no checkpoint found, return 0 (start from beginning)
}

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

  // Find the most recent checkpoint and slice messages from there
  const checkpointIndex = findMostRecentCheckpointIndex(messages);
  const slicedMessages = messages.slice(checkpointIndex);

  let windowedIR: WindowedIR;
  let appliedCompaction = false;
  let compactSummary: string | undefined;

  // Apply context windowing
  windowedIR = applyContextWindow(slicedMessages, modelConfig.context);

  // Check if we need to autocompact the unsliced messages (original full history)
  if (shouldAutoCompactHistory(messages, modelConfig.context, config.autoCompact)) {
    const processedMessages = formatMessagesForSummary(messages);
    windowedIR = applyContextWindow(processedMessages, modelConfig.context);
    
    try {
      const compactSummaryResult = await runInternal({
        config,
        transport, 
        windowedIR,
        abortSignal,
        onTokens,
        onAutofixJson,
        modelOverride,
        appliedCompaction: false,
      });
      compactSummary = processCompactedHistory(compactSummaryResult)
      // Note: we don't clear the windowedIR here, the summary will be used in system prompt
      appliedCompaction = true;
    } catch (error) {
      // If compaction fails, just continue without compaction - keep using the sliced messages
      appliedCompaction = false;
      windowedIR = applyContextWindow(slicedMessages, modelConfig.context);
    }
  }

  return await runInternal({
    config,
    modelOverride,
    windowedIR,
    onTokens,
    onAutofixJson,
    abortSignal,
    transport,
    skipSystemPrompt,
    appliedCompaction,
    compactSummary
  });
}