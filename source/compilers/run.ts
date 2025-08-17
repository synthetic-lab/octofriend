import { runAnthropicAgent } from "./anthropic.ts";
import { runResponsesAgent } from "./responses.ts";
import { runAgent } from "./standard.ts";
import { Config, getModelFromConfig } from "../config.ts";
import { HistoryItem } from "../history.ts";

export async function run({
  config, modelOverride, history, onTokens, onAutofixJson, abortSignal
}: {
  config: Config,
  modelOverride: string | null,
  history: HistoryItem[],
  onTokens: (t: string, type: "reasoning" | "content") => any,
  onAutofixJson: (done: Promise<void>) => any,
  abortSignal: AbortSignal,
}) {
  const modelConfig = getModelFromConfig(config, modelOverride);
  const run = (() => {
    if(modelConfig.type == null || modelConfig.type === "standard") return runAgent;
    if(modelConfig.type === "openai-responses") return runResponsesAgent;
    const _: "anthropic" = modelConfig.type;
    return runAnthropicAgent;
  })();

  return await run({ config, modelOverride, history, onTokens, onAutofixJson, abortSignal });
}
