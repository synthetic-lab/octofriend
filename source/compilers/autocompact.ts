import { AutoCompactConfig, Config } from "../config.ts";
import { sequenceId } from "../history.ts";
import { LlmIR, AgentResult } from "../ir/llm-ir.ts";
import { toLlmIR } from "../ir/convert-history-ir.ts";
import { compactPrompt } from "../prompts/compact-prompt.ts";
import { getModelFromConfig } from "../config.ts";
import { run } from "./run.ts";
import { countIRTokens } from "../ir/ir-windowing.ts";
import { Transport } from "../transports/transport-common.ts";
import { CompactionRequestError } from "../errors.ts";

const AUTOCOMPACT_THRESHOLD = 0.9;

export const compactionCompilerExplanation = (summary: string) => {
  return `# Conversation History Summary

The following text is a condensed summary of all previous messages in this conversation:

${summary}

---

## IMPORTANT: Context Has Been Compacted

The individual messages from earlier in this conversation are no longer available. They have been compressed into the summary text above to save tokens.

**Your instructions:**
1. Read the summary text above - it contains all the information from the previous messages
2. Treat the summary as your complete reference for what happened earlier in this conversation
3. Continue working on your current task exactly where you left off

Resume your work now.`
}

export function findMostRecentCompactionCheckpointIndex(messages: LlmIR[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "compaction-checkpoint") {
      return i;
    }
  }
  return 0;
}

// checks the token length starting from a compaction-checkpoint (or the beginning if no checkpoint exists)
// if it exceeds AUTOCOMPACT_THRESHOLD * the model's max context window, return true
export function shouldAutoCompactHistory(
  messages: LlmIR[],
  config: Config,
  modelOverride: string | null,
  autoCompactSettings?: AutoCompactConfig,
): boolean {
  if(autoCompactSettings?.enabled === false) return false;

  const checkpointIndex = findMostRecentCompactionCheckpointIndex(messages);
  const slicedMessages = messages.slice(checkpointIndex)
  const modelConfig = getModelFromConfig(config, modelOverride);
  const maxContextWindow = modelConfig.context;
  const maxAllowedTokens = Math.floor(maxContextWindow * AUTOCOMPACT_THRESHOLD);
  const currentTokens = countIRTokens(slicedMessages);

  return currentTokens >= maxAllowedTokens;
}

// only summarize starting from the most recent compaction-checkpoint (if it exists, otherwise from the beginning)
export async function generateCompactionSummary(
  messages: LlmIR[],
  config: Config,
  transport: Transport,
  modelOverride: string | null,
  onTokens: (t: string, type: "reasoning" | "content" | "tool") => any,
  onAutofixJson: (done: Promise<void>) => any,
  abortSignal: AbortSignal
): Promise<string | null> {
  const checkpointIndex = findMostRecentCompactionCheckpointIndex(messages);
  const slicedMessages = messages.slice(checkpointIndex)
  const processedMessages = formatMessagesForSummary(slicedMessages);

  const result = await run({
    config,
    modelOverride,
    messages: processedMessages,
    onTokens,
    onAutofixJson,
    abortSignal,
    transport,
    skipSystemPrompt: true,
  });

  if(abortSignal.aborted) return null;

  if (!result.success) {
    throw new CompactionRequestError(result.requestError, result.curl);
  }

  const summary = processCompactedHistory(result);
  if (summary == null) {
    throw new CompactionRequestError(
      "Compaction result was empty, continuing without compacting messages."
    );
  }
  return summary;
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
