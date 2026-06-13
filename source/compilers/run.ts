import { runAnthropicAgent } from "../libocto/compilers/anthropic.ts";
import type { AnthropicCompilerModel } from "../libocto/compilers/anthropic.ts";
import { runResponsesAgent } from "../libocto/compilers/responses.ts";
import { runAgent } from "../libocto/compilers/standard.ts";
import Anthropic from "@anthropic-ai/sdk";
import { APP_METADATA, ModelConfig } from "../config.ts";
import { octoAgent } from "../ir/octo-ir.ts";
import { JsonFixResponse } from "../prompts/autofix-prompts.ts";
import { LoadedTools } from "../tools/index.ts";
import { Transport } from "../transports/transport-common.ts";
import type { CompilerModalities } from "../libocto/compilers/compiler-interface.ts";
import type {
  CompilerResult,
  CompilerTokenType,
  CompilerUsage,
} from "../libocto/compilers/compiler-interface.ts";
import { compilerUsageHasTokens } from "../libocto/compilers/compiler-interface.ts";
import type { OpenAICompilerModel } from "../libocto/compilers/openai-shared.ts";
import { getDefaultOpenaiClient } from "./openai.ts";
import { trackTokens } from "../token-tracker.ts";
import type { LoweredIR } from "../libocto/llm-ir.ts";
import type toolMap from "../tools/tool-defs/index.ts";

type RunArgs<Tools extends Partial<LoadedTools> | undefined = undefined> = {
  apiKey: string;
  model: ModelConfig;
  messages: Array<LoweredIR<typeof toolMap>>;
  autofixJson: (badJson: string, signal: AbortSignal) => Promise<JsonFixResponse>;
  handlers: {
    onTokens: (t: string, type: CompilerTokenType<Tools>) => any;
    onAutofixJson: (done: Promise<void>) => any;
  };
  abortSignal: AbortSignal;
  transport: Transport;
  systemPrompt?: () => Promise<string>;
  tools?: Tools;
};

export async function run<Tools extends Partial<LoadedTools> | undefined = undefined>({
  model,
  apiKey,
  messages,
  handlers,
  autofixJson,
  abortSignal,
  transport,
  systemPrompt,
  tools,
}: RunArgs<Tools>): Promise<CompilerResult<typeof octoAgent, Tools>> {
  const result = await (async () => {
    const params = {
      abortSignal,
      systemPrompt,
      irs: messages,
      onTokens: handlers.onTokens,
      autofixJson: (badJson: string, signal: AbortSignal) => {
        const fixPromise = autofixJson(badJson, signal);
        handlers.onAutofixJson(fixPromise.then(() => {}));
        return fixPromise;
      },
      tools,
      transport,
    };

    if (model.type == null || model.type === "standard") {
      return runAgent<typeof octoAgent, Tools>({
        ...params,
        model: standardOpenAICompilerModel(model, apiKey),
      });
    }

    if (model.type === "openai-responses") {
      return runResponsesAgent<typeof octoAgent, Tools>({
        ...params,
        model: responsesOpenAICompilerModel(model, apiKey),
      });
    }

    const _: "anthropic" = model.type;
    return runAnthropicAgent<typeof octoAgent, Tools>({
      ...params,
      model: anthropicCompilerModel(model, apiKey),
    });
  })();

  trackCompilerResultUsage(model.model, result);
  return result;
}

function trackCompilerResultUsage(model: string, result: CompilerResult<typeof octoAgent>): void {
  const usage = compilerResultUsage(result);
  if (!usage || !compilerUsageHasTokens(usage)) return;
  trackTokens(model, "input", usage.input.total);
  trackTokens(model, "output", usage.output);
}

function compilerResultUsage(result: CompilerResult<typeof octoAgent>): CompilerUsage | undefined {
  if (result.success) return result.data.usage;
  if ("usage" in result.error) return result.error.usage;
  return undefined;
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
