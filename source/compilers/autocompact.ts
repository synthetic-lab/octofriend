import { AutoCompactConfig, Config } from "../config.ts";
import { sequenceId } from "../history.ts";
import { LlmIR, toLlmIR, AgentResult } from "../ir/llm-ir.ts";
import { compactPrompt, CompactResponse } from "../prompts/compact-prompt.ts";
import { getModelFromConfig } from "../config.ts";
import { run } from "./run.ts";
import { applyContextWindow, countIRTokens } from "../ir/ir-windowing.ts";
import { Transport } from "../transports/transport-common.ts";

export function findMostRecentCompactionCheckpointIndex(messages: LlmIR[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "compaction-checkpoint") {
      return i;
    }
  }
  return 0;
}

export function shouldAutoCompactHistory(
  messages: LlmIR[],
  onError: (errString: string) => void,
  config: Config,
  modelOverride: string | null,
  autoCompactSettings?: AutoCompactConfig,
): boolean {
  if (!autoCompactSettings?.enabled) return false;

  const contextThreshold = autoCompactSettings.contextThreshold;
  if (contextThreshold <= 0 || contextThreshold > 1) {
    onError("Tried autocompacting, but threshold is invalid number (must be between 0 and 1)")
    return false;
  }
  const checkpointIndex = findMostRecentCompactionCheckpointIndex(messages);
  const slicedMessages = messages.slice(checkpointIndex)
  const modelConfig = getModelFromConfig(config, modelOverride);
  const maxContextWindow = modelConfig.context;
  const maxAllowedTokens = Math.floor(maxContextWindow * contextThreshold);
  const currentTokens = countIRTokens(slicedMessages);

  return currentTokens >= maxAllowedTokens;
}


export async function generateCompactionSummary(
  messages: LlmIR[],
  config: Config,
  transport: Transport,
  onTokens: (t: string, type: "reasoning" | "content" | "tool") => any,
  onAutofixJson: (done: Promise<void>) => any
): Promise<string | null> {
  const processedMessages = formatMessagesForSummary(messages);

  const modelConfig = getModelFromConfig(config, null);
  const windowedIR = applyContextWindow(processedMessages, modelConfig.context);
  
  try {
    const result = await run({
      config,
      modelOverride: null,
      messages: windowedIR.ir,
      onTokens,
      onAutofixJson,
      abortSignal: new AbortController().signal,
      transport,
    });
    const summary = processCompactedHistory(result);
    return summary ?? null;
  } catch (e) {
    return null;
  }
}

export function formatMessagesForSummary(messages: LlmIR[]): LlmIR[] {
  const lines: string[] = [];

  for (const message of messages) {
    const { role, ...rest } = message;
    lines.push(`${message.role}: ${JSON.stringify(rest)}`);
  }

  const conjoinedMessages = lines.join("\n");
  const promptText = compactPrompt(conjoinedMessages);

  return toLlmIR([
    {
      type: "user" as const,
      id: sequenceId(),
      content: promptText,
    },
  ]);
}

export function processCompactedHistory(
  compactSummaryAgentResult: AgentResult
): string | undefined {
  if (!compactSummaryAgentResult.success) {
    return;
  }

  const assistantMessage = compactSummaryAgentResult.output.find(
    (msg) => msg.role === "assistant"
  );
  if (!assistantMessage || assistantMessage.role !== "assistant") {
    return;
  }

  return assistantMessage.content
}
