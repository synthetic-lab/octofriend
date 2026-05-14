import type { AgentResult, OctoIR } from "../ir/octo-ir.ts";
import { compactPrompt } from "../prompts/compact-prompt.ts";
import { ModelConfig } from "../config.ts";
import { JsonFixResponse } from "../prompts/autofix-prompts.ts";
import { run } from "./run.ts";
import { approximateIRTokens } from "../ir/count-ir-tokens.ts";
import { CompactionRequestError } from "../errors.ts";
import { Transport } from "../transports/transport-common.ts";

const AUTOCOMPACT_THRESHOLD = 0.9;

export const COMPACTION_COMPILER_PREFIX = `# Conversation History Summary

The following text is a condensed summary of all previous messages in this conversation:

`;

export const COMPACTION_COMPILER_SUFFIX = `

---

## IMPORTANT: Context Has Been Compacted

The individual messages from earlier in this conversation are no longer available. They have been compressed into the summary text above to save tokens.

**Your instructions:**
1. Read the summary text above - it contains all the information from the previous messages
2. Treat the summary as your complete reference for what happened earlier in this conversation
3. Continue working on your current task exactly where you left off

Resume your work now.`;

export const compactionCompilerExplanation = (summary: string) => {
  return `${COMPACTION_COMPILER_PREFIX}${summary}${COMPACTION_COMPILER_SUFFIX}`;
};

export function findMostRecentCompactionCheckpointIndex(messages: OctoIR[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "checkpoint") {
      return i;
    }
  }
  return 0;
}

// checks the token length starting from a checkpoint (or the beginning if no checkpoint exists)
// if it exceeds AUTOCOMPACT_THRESHOLD * the model's max context window, return true
export function shouldAutoCompactHistory(model: ModelConfig, messages: OctoIR[]): boolean {
  const checkpointIndex = findMostRecentCompactionCheckpointIndex(messages);
  const slicedMessages = messages.slice(checkpointIndex);
  const maxContextWindow = model.context;
  const maxAllowedTokens = Math.floor(maxContextWindow * AUTOCOMPACT_THRESHOLD);
  const currentTokens = approximateIRTokens(slicedMessages);

  return currentTokens >= maxAllowedTokens;
}

// only summarize starting from the most recent checkpoint (if it exists, otherwise from the beginning)
export async function generateCompactionSummary({
  apiKey,
  model,
  messages,
  autofixJson,
  handlers,
  abortSignal,
  transport,
}: {
  apiKey: string;
  model: ModelConfig;
  messages: OctoIR[];
  autofixJson: (badJson: string, signal: AbortSignal) => Promise<JsonFixResponse>;
  handlers: {
    onTokens: (t: string, type: "reasoning" | "content" | "tool") => any;
    onAutofixJson: (done: Promise<void>) => any;
  };
  abortSignal: AbortSignal;
  transport: Transport;
}): Promise<string | null> {
  const checkpointIndex = findMostRecentCompactionCheckpointIndex(messages);
  const slicedMessages = messages.slice(checkpointIndex);
  const summaryMessages: OctoIR[] = [
    ...slicedMessages,
    {
      role: "user",
      content: [{ type: "text", content: compactPrompt() }],
    },
  ];

  const result = await run({
    apiKey,
    model,
    handlers,
    autofixJson,
    abortSignal,
    transport,
    messages: summaryMessages,
  });

  if (abortSignal.aborted) return null;

  if (!result.success) {
    throw new CompactionRequestError(result.error.requestError, result.error.curl);
  }

  const summary = processCompactedHistory(result);
  if (summary == null || summary === "") {
    throw new CompactionRequestError(
      "Compaction result was empty, continuing without compacting messages.",
    );
  }
  return summary;
}

export function processCompactedHistory(
  compactSummaryAgentResult: AgentResult,
): string | undefined {
  if (!compactSummaryAgentResult.success) {
    return;
  }
  const assistantMessage = compactSummaryAgentResult.data.output;

  if (assistantMessage.content) {
    return assistantMessage.content;
  }

  if (assistantMessage.reasoningContent) {
    return assistantMessage.reasoningContent;
  }

  return undefined;
}
