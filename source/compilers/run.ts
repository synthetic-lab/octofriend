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
  // TODO (steph): make return default to true once connected with app.tsx
  if (!autoCompactSettings?.enabled) return false;

  const contextThreshold = autoCompactSettings.contextThreshold;

  if (contextThreshold <= 0 || contextThreshold > 1) {
    // TODO (steph): surface error that contextThreshold must be between 0 and 1.
  }
  const maxAllowedTokens = Math.floor(context * contextThreshold);
  const currentTokens = countIRTokens(messages);

  return currentTokens >= maxAllowedTokens;
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

  let compactSummary: string | undefined;
  let windowedIR: WindowedIR;
  let processedMessages = messages

  if (shouldAutoCompactHistory(messages, modelConfig.context, config.autoCompact)) {
    processedMessages = formatMessagesForSummary(messages);
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
      windowedIR = {
        appliedWindow: true,
        ir: new Array<LlmIR>(),
      }
      windowedIR = applyContextWindow(windowedIR.ir, modelConfig.context)
      // Clear history and just pass in compactSummary into system prompt
    } catch (error) {
      // TODO: surface an error message
    }
  } else {
    windowedIR = applyContextWindow(processedMessages, modelConfig.context);
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
    appliedCompaction: !!compactSummary,
    compactSummary
  });
}
