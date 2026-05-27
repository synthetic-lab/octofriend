import { runAnthropicAgent } from "../libocto/compilers/anthropic.ts";
import type { AnthropicCompilerModel } from "../libocto/compilers/anthropic.ts";
import { runResponsesAgent } from "../libocto/compilers/responses.ts";
import { runAgent } from "../libocto/compilers/standard.ts";
import Anthropic from "@anthropic-ai/sdk";
import { APP_METADATA, ModelConfig } from "../config.ts";
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
import type { CompilerModalities } from "../libocto/compilers/compiler-interface.ts";
import type { OpenAICompilerModel } from "../libocto/compilers/openai-shared.ts";
import { getDefaultOpenaiClient } from "./openai.ts";

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
  const checkpointIndex = findMostRecentCompactionCheckpointIndex(messages);
  const slicedMessages = lowerToolRejects(messages.slice(checkpointIndex));
  const optimizedMessages = optimizeFiles(slicedMessages, model.modalities);
  const loweredMessages = lowerTrajectories<typeof octoAgent>(optimizedMessages);

  const params = {
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
  };

  if (model.type == null || model.type === "standard") {
    return await runAgent<typeof octoAgent>({
      ...params,
      model: standardOpenAICompilerModel(model, apiKey),
    });
  }

  if (model.type === "openai-responses") {
    return await runResponsesAgent<typeof octoAgent>({
      ...params,
      model: responsesOpenAICompilerModel(model, apiKey),
    });
  }

  const _: "anthropic" = model.type;
  return await runAnthropicAgent<typeof octoAgent>({
    ...params,
    model: anthropicCompilerModel(model, apiKey),
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

function compilerModalities(model: ModelConfig): CompilerModalities {
  return ["text", ...(model.modalities?.image?.enabled ? (["vision"] as const) : [])];
}

function standardOpenAICompilerModel(model: ModelConfig, apiKey: string): OpenAICompilerModel {
  return {
    client: getDefaultOpenaiClient({ baseUrl: model.baseUrl, apiKey }),
    model: model.model,
    reasoningEffort: model.reasoning,
    modalities: compilerModalities(model),
  };
}

function responsesOpenAICompilerModel(model: ModelConfig, apiKey: string): OpenAICompilerModel {
  return {
    client: getDefaultOpenaiClient({ baseUrl: model.baseUrl, apiKey }),
    model: model.model,
    reasoningEffort: model.reasoning,
    modalities: compilerModalities(model),
  };
}

function anthropicCompilerModel(model: ModelConfig, apiKey: string): AnthropicCompilerModel {
  const thinking = anthropicThinking(model.reasoning);
  // TODO: allow this to be configurable. It's set to 32000 because that's Claude 4.1 Opus's max.
  const maxTokens = Math.min(32 * 1000 - (thinking?.budget_tokens || 0), model.context);
  return {
    client: new Anthropic({
      baseURL: model.baseUrl,
      apiKey,
      defaultHeaders: {
        "User-Agent": `octofriend/${APP_METADATA.version}`,
      },
    }),
    model: model.model,
    maxTokens,
    thinking,
    modalities: compilerModalities(model),
  };
}

function anthropicThinking(
  reasoning: ModelConfig["reasoning"],
): AnthropicCompilerModel["thinking"] {
  if (reasoning == null) return undefined;
  if (reasoning === "high") return { type: "enabled", budget_tokens: 8192 };
  if (reasoning === "medium") return { type: "enabled", budget_tokens: 4096 };
  return { type: "enabled", budget_tokens: 2048 };
}
