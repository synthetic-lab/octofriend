/**
 * AutoCompact: Automatic conversation history compaction
 *
 * This module auto-compact conversation history
 * when it exceeds a token threshold set in the config. 

 * The compaction process:
 * 1. Summarizes all messages using an LLM
 * 2. Replaces entire history with a single CompactSummaryItem
 * 3. Preserves the conversation context while significantly reducing token count
 */
import { Config } from "../config.ts";
import { sequenceId } from "../history.ts";
import { AgentResult, LlmIR, toLlmIR } from "../ir/llm-ir.ts";
import { compactPrompt, CompactResponse } from "../prompts/compact-prompt.ts";
import { ActivityMode } from "../state.ts";
import { Transport } from "../transports/transport-common.ts";
import { run } from "./run.ts";

export function formatMessagesForSummary(messages: LlmIR[]): LlmIR[] {
  const lines: string[] = [];

  for (const message of messages) {
    // Create a copy without the id field and stringify
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
  
  let parsed;
  try {
    parsed = JSON.parse(assistantMessage.content);
  } catch {
    return;
  }
  
  const validated = CompactResponse.slice(parsed);

  if (!validated.success) {
    return;
  }
  return validated.summary;
}