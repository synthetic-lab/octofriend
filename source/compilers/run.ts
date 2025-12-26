import { runAnthropicAgent } from "./anthropic.ts";
import { runResponsesAgent } from "./responses.ts";
import { runAgent } from "./standard.ts";
import { Config, ModelConfig, assertKeyForModel } from "../config.ts";
import { LlmIR } from "../ir/llm-ir.ts";
import { applyContextWindow } from "../ir/ir-windowing.ts";
import { Transport } from "../transports/transport-common.ts";
import { findMostRecentCompactionCheckpointIndex } from "./autocompact.ts";
import { autofixJson as autofixJsonImpl } from "../compilers/autofix.ts";
import * as toolMap from "../tools/tool-defs/index.ts";

export async function run({
  config, model, messages, onTokens, onAutofixJson, abortSignal, transport, systemPrompt
}: {
  model: ModelConfig,
  config: Config,
  messages: LlmIR[],
  onTokens: (t: string, type: "reasoning" | "content" | "tool") => any,
  onAutofixJson: (done: Promise<void>) => any,
  abortSignal: AbortSignal,
  transport: Transport,
  systemPrompt?: (appliedWindow: boolean) => Promise<string>,
}) {
  const runInternal = (() => {
    if(model.type == null || model.type === "standard") return runAgent;
    if(model.type === "openai-responses") return runResponsesAgent;
    const _: "anthropic" = model.type;
    return runAnthropicAgent;
  })();

  const checkpointIndex = findMostRecentCompactionCheckpointIndex(messages);
  const slicedMessages = messages.slice(checkpointIndex);

  const windowedIR = applyContextWindow(slicedMessages, model.context);
  const wrappedPrompt = systemPrompt == null ? systemPrompt : async () => {
    return systemPrompt(windowedIR.appliedWindow);
  };

  const apiKey = await assertKeyForModel(model, config);

  const toolsDefinitions = toolMap;
  const hasMcp = config.mcpServers != null && Object.keys(config.mcpServers).length > 0;
  const tools = hasMcp ? toolsDefinitions : (() => {
    const toolsCopy: Partial<typeof toolsDefinitions> = { ...toolsDefinitions };
    delete toolsCopy.mcp;
    return toolsCopy;
  })();

  return await runInternal({
    model,
    apiKey,
    windowedIR,
    onTokens,
    onAutofixJson,
    abortSignal,
    transport,
    systemPrompt: wrappedPrompt,
    autofixJson: (badJson: string, signal: AbortSignal) => autofixJsonImpl(config, badJson, signal),
    tools,
  });
}
