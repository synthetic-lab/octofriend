import { runAnthropicAgent } from "./anthropic.ts";
import { runResponsesAgent } from "./responses.ts";
import { runAgent } from "./standard.ts";
import { ModelConfig } from "../config.ts";
import { octoAgent } from "../ir/octo-ir.ts";
import type { OctoIR } from "../ir/octo-ir.ts";
import { QuotaData } from "../utils/quota.ts";
import { findMostRecentCompactionCheckpointIndex } from "./autocompact.ts";
import { JsonFixResponse } from "../prompts/autofix-prompts.ts";
import { LoadedTools } from "../tools/index.ts";
import { Transport } from "../transports/transport-common.ts";
import { lowerTrajectories } from "../libocto/lower-trajectories.ts";
import { optimizeFiles } from "./optimize-files.ts";
import type { FileOptimizerInputIR } from "./optimize-files.ts";

export async function run({
  model,
  apiKey,
  messages,
  handlers,
  autofixJson,
  abortSignal,
  transport,
  systemPrompt,
  tools,
}: {
  apiKey: string;
  model: ModelConfig;
  messages: OctoIR[];
  autofixJson: (badJson: string, signal: AbortSignal) => Promise<JsonFixResponse>;
  handlers: {
    onTokens: (t: string, type: "reasoning" | "content" | "tool") => any;
    onAutofixJson: (done: Promise<void>) => any;
    onQuotaUpdated?: (quota: QuotaData) => void;
  };
  abortSignal: AbortSignal;
  transport: Transport;
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
  const slicedMessages = lowerToolRejects(messages.slice(checkpointIndex));
  const optimizedMessages = optimizeFiles(slicedMessages, model.modalities);
  const loweredMessages = lowerTrajectories<typeof octoAgent>(optimizedMessages);

  return await runInternal<typeof octoAgent>({
    model,
    apiKey,
    abortSignal,
    systemPrompt,
    irs: loweredMessages,
    onTokens: handlers.onTokens,
    onQuotaUpdated: handlers.onQuotaUpdated,
    autofixJson: (badJson: string, signal: AbortSignal) => {
      const fixPromise = autofixJson(badJson, signal);
      handlers.onAutofixJson(fixPromise.then(() => {}));
      return fixPromise;
    },
    tools,
    transport,
  });
}

function lowerToolRejects(messages: OctoIR[]): FileOptimizerInputIR[] {
  return messages.map(ir => {
    if (ir.role === "tool-reject") {
      return {
        role: "tool-skip-output",
        toolCall: ir.toolCall,
        reason: "Tool call rejected by user.",
      };
    }

    return ir;
  });
}
