import { contentToText } from "../libocto/content.ts";
import type { OctoIR } from "./octo-ir.ts";

// ~4 characters per token for English text: https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function getMessageText(msg: OctoIR): string {
  switch (msg.role) {
    case "assistant":
      return (msg.content ?? "") + (msg.reasoningContent ?? "");
    case "user":
    case "tool-output":
      return contentToText(msg.content);
    case "file-read":
    case "file-mutate":
      return msg.content;
    case "tool-runtime-error":
      return msg.error;
    case "tool-validation-error":
      return msg.error;
    case "tool-parse-error":
      return (
        (msg.malformedRequest.call.original.arguments ?? "") + (msg.malformedRequest.error ?? "")
      );
    case "file-outdated":
    case "file-unreadable":
      return msg.error;
    case "checkpoint":
      return contentToText(msg.content);
    case "tool-skip-output":
      return msg.reason;
  }
  return "";
}

export function sumAssistantTokens(ir: Array<{ role: string; tokenUsage?: number }>): number {
  let totalTokens = 0;
  for (const item of ir) {
    if (item.role === "assistant") totalTokens += item.tokenUsage ?? 0;
  }
  return totalTokens;
}

export function approximateIRTokens(ir: OctoIR[]): number {
  // An assistant message contains exact token counts for all inputs/outputs before and including itself
  // up until the assistant message before it (if one exists)
  let mostRecentAssistantIndex = -1;
  for (let i = ir.length - 1; i >= 0; i--) {
    if (ir[i].role === "assistant") {
      mostRecentAssistantIndex = i;
      break;
    }
  }

  const assistantMessagesTokenCount = sumAssistantTokens(ir);

  let trailingTokenCount = 0;
  for (let i = mostRecentAssistantIndex + 1; i < ir.length; i++) {
    const text = getMessageText(ir[i]);
    trailingTokenCount += estimateTokens(text);
  }

  return assistantMessagesTokenCount + trailingTokenCount;
}
