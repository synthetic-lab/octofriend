import { contentToText } from "./content.ts";
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
    case "checkpoint":
      return contentToText(msg.content);
    case "tool-skip-output":
      return msg.reason;
  }
  return "";
}

export function approximateIRTokens(ir: OctoIR[]): number {
  // Provider usage is a raw total for the request that produced the assistant response. Treat the
  // most recent assistant usage as a checkpoint, then estimate only the messages appended after it.
  // Do not sum assistant usages: engines may retokenize, drop hidden reasoning, or otherwise change
  // how prior messages count from one request to the next.
  let mostRecentAssistantIndex = -1;
  for (let i = ir.length - 1; i >= 0; i--) {
    if (ir[i].role === "assistant") {
      mostRecentAssistantIndex = i;
      break;
    }
  }

  const checkpointTokenCount =
    mostRecentAssistantIndex === -1
      ? 0
      : (() => {
          const assistant = ir[mostRecentAssistantIndex];
          if (assistant.role !== "assistant") return 0;
          return assistant.usage.input.total + assistant.usage.output;
        })();

  let trailingTokenCount = 0;
  for (let i = mostRecentAssistantIndex + 1; i < ir.length; i++) {
    const text = getMessageText(ir[i]);
    trailingTokenCount += estimateTokens(text);
  }

  return checkpointTokenCount + trailingTokenCount;
}
