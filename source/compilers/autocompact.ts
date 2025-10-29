/**
 * AutoCompact: Automatic conversation history compaction
 *
 * This module provides functionality to automatically compact conversation history
 * when it exceeds a configured token threshold. Instead of dropping old messages
 * (like context windowing), it summarizes them to preserve important context.
 *
 * Configuration (in config.json5):
 * {
 *   autoCompact: {
 *     enabled: true,
 *     tokenThreshold: 50000,  // Trigger compaction at this many tokens
 *     // Optional: specify a different model for summarization
 *     baseUrl: "https://api.openai.com/v1",
 *     model: "gpt-4o-mini"
 *   }
 * }
 *
 * Usage example (to be integrated):
 * ```typescript
 * // In state.ts, after adding user message or before calling run():
 * if (shouldCompactHistory(history, config)) {
 *   const compacted = await compactHistory(history, config, abortSignal);
 *   set({ history: compacted });
 * }
 * ```
 *
 * The compaction process:
 * 1. Keeps recent messages (~20% of history)
 * 2. Summarizes older messages using an LLM
 * 3. Replaces old messages with a single summary message
 * 4. Preserves the conversation context while reducing token count
 */
import OpenAI from "openai";
import { Config, assertKeyForModel } from "../config.ts";
import { HistoryItem, UserItem, AssistantItem, sequenceId } from "../history.ts";
import { compactHistoryPrompt, CompactResponse } from "../prompts/autofix-prompts.ts";
import { trackTokens } from "../token-tracker.ts";
import { toLlmIR } from "../ir/llm-ir.ts";
import { countIRTokens } from "../ir/ir-windowing.ts";

/**
 * Checks if the conversation history should be compacted based on the configured threshold
 */
export function shouldCompactHistory(
  history: HistoryItem[],
  config: Config,
): boolean {
  if (!config.autoCompact?.enabled) return false;

  const tokenThreshold = config.autoCompact.tokenThreshold;
  const ir = toLlmIR(history);
  const currentTokens = countIRTokens(ir);

  return currentTokens >= tokenThreshold;
}

/**
 * Compacts conversation history by summarizing older messages
 * Returns a new history array with a summary replacing older messages
 */
export async function compactHistory(
  history: HistoryItem[],
  config: Config,
  abortSignal?: AbortSignal,
): Promise<HistoryItem[]> {
  if (!config.autoCompact) {
    throw new Error("autoCompact is not configured");
  }

  // Determine how much history to compact
  // Keep recent messages (last ~20% of history) and compact the rest
  const keepRecentCount = Math.max(
    2,
    Math.floor(history.length * 0.2)
  );

  const toCompact = history.slice(0, -keepRecentCount);
  const toKeep = history.slice(-keepRecentCount);

  // If there's not enough to compact, return original history
  if (toCompact.length === 0) return history;

  // Convert history to a readable format for summarization
  const conversationText = formatHistoryForSummary(toCompact);

  // Get summary from LLM
  const summary = await getSummary(
    config.autoCompact,
    config,
    conversationText,
    abortSignal
  );

  if (!summary) {
    // If summarization fails, return original history
    return history;
  }

  // Create a new history with the summary as the first message
  const summaryMessage: UserItem = {
    type: "user",
    id: sequenceId(),
    content: `[Previous conversation summary]\n${summary}`,
  };

  return [summaryMessage, ...toKeep];
}

/**
 * Formats history items into a readable text format for summarization
 */
function formatHistoryForSummary(history: HistoryItem[]): string {
  const lines: string[] = [];

  for (const item of history) {
    if (item.type === "user") {
      lines.push(`User: ${item.content}`);
    } else if (item.type === "assistant") {
      lines.push(`Assistant: ${item.content}`);
    } else if (item.type === "tool") {
      lines.push(`[Tool call: ${item.tool.function.name}]`);
    } else if (item.type === "tool-output") {
      lines.push(`[Tool result]`);
    } else if (item.type === "notification") {
      lines.push(`[Notification: ${item.content}]`);
    }
    // Skip other internal message types (errors, etc.) as they're less relevant for summary
  }

  return lines.join("\n");
}

/**
 * Calls the LLM to generate a summary of the conversation history
 */
async function getSummary(
  modelConf: { baseUrl?: string; apiEnvVar?: string; model?: string },
  config: Config,
  conversationText: string,
  abortSignal?: AbortSignal,
): Promise<string | null> {
  // Use default model from config if not specified
  const baseUrl = modelConf.baseUrl || config.models[0].baseUrl;
  const model = modelConf.model || config.models[0].model;

  const apiKey = await assertKeyForModel({ baseUrl }, config);
  const client = new OpenAI({
    baseURL: baseUrl,
    apiKey,
  });

  try {
    const response = await client.chat.completions.create(
      {
        model,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: compactHistoryPrompt(conversationText),
          },
        ],
        response_format: {
          type: "json_object",
        },
      },
      abortSignal ? { signal: abortSignal } : undefined
    );

    if (response.usage) {
      trackTokens(model, "input", response.usage.prompt_tokens);
      trackTokens(model, "output", response.usage.completion_tokens);
    }

    const result = response.choices[0].message.content;
    if (result == null) return null;

    // Parse and validate the response
    const parsed = JSON.parse(result);
    const validated = CompactResponse.slice(parsed);

    if (!validated.success) return null;

    return validated.summary;
  } catch {
    return null;
  }
}
