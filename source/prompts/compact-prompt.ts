import { t, toTypescript } from "structural";

export const CompactSuccess = t.subtype({
  success: t.value(true),
  summary: t.str,
});
export const CompactFailure = t.subtype({
  success: t.value(false),
});
export const CompactResponse = CompactSuccess.or(CompactFailure);

export function compactPrompt(conversationHistory: string) {
  return (
`You are helping to compact a conversation history to save context tokens. Your task is to create a concise summary of the conversation history provided below that preserves all critical information while being as brief as possible.

The summary should:
- Preserve key decisions, implementations, and outcomes
- Include important context that might be needed for future messages
- Maintain technical details that could be referenced later
- Be written in a clear, factual style

Respond with JSON in the following format:

// Success response:
${toTypescript({ CompactSuccess })}

// Failure response (if the history cannot be meaningfully summarized):
${toTypescript({ CompactFailure })}

Here's the conversation history to summarize:
${conversationHistory}`
  );
}