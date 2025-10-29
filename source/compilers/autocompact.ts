import { Config } from "../config.ts";
import { sequenceId } from "../history.ts";
import { LlmIR, toLlmIR, AgentResult } from "../ir/llm-ir.ts";
import { compactPrompt, CompactResponse } from "../prompts/compact-prompt.ts";
import { getModelFromConfig } from "../config.ts";
import { run } from "./run.ts";
import { applyContextWindow, countIRTokens } from "../ir/ir-windowing.ts";
import { Transport } from "../transports/transport-common.ts";

export async function generateCompactionSummary(
  messages: LlmIR[],
  config: Config,
  transport: Transport
): Promise<string | null> {
  // Format messages for summarization
  const processedMessages = formatMessagesForSummary(messages);

  // Apply context window to avoid overwhelming the model
  const modelConfig = getModelFromConfig(config, null);
  const windowedIR = applyContextWindow(processedMessages, modelConfig.context);

  let summaryText = "";

  try {
    const result = await run({
      config,
      modelOverride: null,
      messages: windowedIR.ir,
      onTokens: (tokens) => {
        summaryText += tokens;
      },
      onAutofixJson: (done) => {
        /* no-op for compaction */
      },
      abortSignal: new AbortController().signal,
      transport,
      skipSystemPrompt: true, // Don't add system prompt to compaction requests
    });

    const summary = processCompactedHistory(result);
    console.log("Summary: ", summary)
    return summary ?? null;
  } catch (e) {
    // If autocompaction fails, return null
    console.error("Generate compaction summary failed:", e);
    return null;
  }
}

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
