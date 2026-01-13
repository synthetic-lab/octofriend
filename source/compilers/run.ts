import { runAnthropicAgent } from "./anthropic.ts";
import { runResponsesAgent } from "./responses.ts";
import { runAgent } from "./standard.ts";
import { ModelConfig } from "../config.ts";
import { LlmIR } from "../ir/llm-ir.ts";
import { findMostRecentCompactionCheckpointIndex } from "./autocompact.ts";
import { JsonFixResponse } from "../prompts/autofix-prompts.ts";
import * as toolMap from "../tools/tool-defs/index.ts";
import { LoadedTools } from "../tools/index.ts";

export async function run({
  model,
  apiKey,
  messages,
  handlers,
  autofixJson,
  abortSignal,
  systemPrompt,
  tools,
}: {
  apiKey: string;
  model: ModelConfig;
  messages: LlmIR[];
  autofixJson: (badJson: string, signal: AbortSignal) => Promise<JsonFixResponse>;
  handlers: {
    onTokens: (t: string, type: "reasoning" | "content" | "tool") => any;
    onAutofixJson: (done: Promise<void>) => any;
  };
  abortSignal: AbortSignal;
  systemPrompt?: () => Promise<string>;
  tools?: Partial<LoadedTools>;
}) {
  const runInternal = (() => {
    if (model.type == null || model.type === "standard") return runAgent;
    if (model.type === "openai-responses") return runResponsesAgent;
    const _: "anthropic" = model.type;
    return runAnthropicAgent;
  })();

  const checkpointIndex = findMostRecentCompactionCheckpointIndex(messages);
  const slicedMessages = messages.slice(checkpointIndex);

  return await runInternal({
    model,
    apiKey,
    abortSignal,
    systemPrompt,
    irs: slicedMessages,
    onTokens: handlers.onTokens,
    autofixJson: (badJson: string, signal: AbortSignal) => {
      const fixPromise = autofixJson(badJson, signal);
      handlers.onAutofixJson(fixPromise.then(() => {}));
      return fixPromise;
    },
    tools,
  });
}
