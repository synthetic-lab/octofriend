import type { OctoIR, octoAgent } from "../ir/octo-ir.ts";
import type { Content } from "../libocto/llm-ir.ts";
import type { CompilerResult } from "./compiler-interface.ts";
import { compactPrompt } from "../prompts/compact-prompt.ts";
import { ModelConfig } from "../config.ts";
import { JsonFixResponse } from "../prompts/autofix-prompts.ts";
import { run } from "./run.ts";
import { approximateIRTokens } from "../ir/count-ir-tokens.ts";
import { Transport } from "../transports/transport-common.ts";
import { Result, ok, err } from "../result.ts";

const AUTOCOMPACT_THRESHOLD = 0.9;

export type CompactionError = {
  requestError: string;
  curl: string | null;
};

const COMPACTION_CHECKPOINT_PREFIX = `# Conversation History Summary

The following text is a condensed summary of all previous messages in this conversation:

`;

const COMPACTION_CHECKPOINT_SUFFIX = `

---

## IMPORTANT: Context Has Been Compacted

The individual messages from earlier in this conversation are no longer available. They have been compressed into the summary text above to save tokens.

**Your instructions:**
1. Read the summary text above - it contains all the information from the previous messages
2. Treat the summary as your complete reference for what happened earlier in this conversation
3. Continue working on your current task exactly where you left off

Resume your work now.`;

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
export async function generateCompactionCheckpointContent({
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
}): Promise<Result<Content["content"] | null, CompactionError>> {
  const checkpointIndex = findMostRecentCompactionCheckpointIndex(messages);
  const slicedMessages = messages.slice(checkpointIndex);
  const summaryMessages: OctoIR[] = [
    ...slicedMessages,
    {
      role: "user",
      content: [{ type: "text", content: compactPrompt() }],
    },
  ];

  const compactRunResult = await run({
    apiKey,
    model,
    handlers,
    autofixJson,
    abortSignal,
    transport,
    messages: summaryMessages,
  });

  if (abortSignal.aborted) return ok(null);

  if (!compactRunResult.success) {
    return err({
      requestError: compactRunResult.error.requestError,
      curl: compactRunResult.error.curl,
    });
  }

  const summary = processCompactedHistory(compactRunResult);
  if (summary == null || summary === "") {
    return err({
      requestError: "Compaction result was empty, continuing without compacting messages.",
      curl: null,
    });
  }
  return ok([
    { type: "text", content: COMPACTION_CHECKPOINT_PREFIX },
    { type: "text", content: summary },
    { type: "text", content: COMPACTION_CHECKPOINT_SUFFIX },
  ]);
}

export function processCompactedHistory(
  compactSummaryResult: CompilerResult<typeof octoAgent>,
): string | undefined {
  if (!compactSummaryResult.success) {
    return;
  }
  const assistantMessage = compactSummaryResult.data.output;

  if (assistantMessage.content) {
    return assistantMessage.content;
  }

  if (assistantMessage.reasoningContent) {
    return assistantMessage.reasoningContent;
  }

  return undefined;
}
