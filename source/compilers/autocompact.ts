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
import { HistoryItem, sequenceId } from "../history.ts";
import { toLlmIR } from "../ir/llm-ir.ts";
import { countIRTokens } from "../ir/ir-windowing.ts";
import { compactPrompt, CompactResponse } from "../prompts/compact-prompt.ts";
import { ActivityMode } from "../state.ts";
import { Transport } from "../transports/transport-common.ts";
import { run } from "./run.ts";

export function formatHistoryForSummary(history: HistoryItem[]): string {
  const lines: string[] = [];

  for (const item of history) {
    // Create a copy without the id field and stringify
    const { id, ...rest } = item;
    lines.push(`${item.type}: ${JSON.stringify(rest)}`);
  }

  return lines.join("\n");
}

export async function getSummary(
  config: Config,
  transport: Transport,
  conversationText: string,
  abortSignal: AbortSignal,
  onTokens: (tokens: string, type: "content" | "reasoning" | "tool") => void,
  onActivity: (activity: ActivityMode, done: Promise<void>) => void,
): Promise<string | null> {
  const promptText = compactPrompt(conversationText);

  try {
    const messages = toLlmIR([
      {
        type: "user" as const,
        id: sequenceId(),
        content: promptText,
      },
    ]);

    const result = await run({
      config,
      transport,
      modelOverride: null,
      messages,
      abortSignal,
      onTokens,
      onActivity,
      skipSystemPrompt: true,
    });

    if (!result.success) {
      // TODO: surface an error
      return null;
    }

    const assistantMessage = result.output.find(msg => msg.role === "assistant");
    if (!assistantMessage || assistantMessage.role !== "assistant") {
      // TODO: surface an error
      return null;
    }
    const parsed = JSON.parse(assistantMessage.content);
    const validated = CompactResponse.slice(parsed);

    if (!validated.success) {
      // TODO: surface an error
      return null;
    }
    return validated.summary;
  } catch {
    return null;
  }
}