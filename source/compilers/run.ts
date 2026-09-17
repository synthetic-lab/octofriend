import { runAnthropicAgent } from "../libocto/compilers/anthropic.ts";
import type { AnthropicCompilerModel } from "../libocto/compilers/anthropic.ts";
import { runResponsesAgent } from "../libocto/compilers/responses.ts";
import { runAgent } from "../libocto/compilers/standard.ts";
import Anthropic from "@anthropic-ai/sdk";
import { APP_METADATA, ModelConfig } from "../config.ts";
import type {
  ApiKeyAuth,
  ApiKeyModelConfig,
  CodexModelConfig,
  OAuthLoadedAuth,
} from "../config.ts";
import type { Agent } from "../libocto/llm-ir.ts";
import type { CompilerModalities } from "../libocto/compilers/compiler-interface.ts";
import type {
  Compiler,
  CompilerResult,
  CompilerUsage,
} from "../libocto/compilers/compiler-interface.ts";
import { compilerUsageHasTokens } from "../libocto/compilers/compiler-interface.ts";
import type { OpenAICompilerModel } from "../libocto/compilers/openai-shared.ts";
import { getCodexOpenaiClient, getDefaultOpenaiClient } from "./openai.ts";
import { trackTokens } from "../token-tracker.ts";

export type ModelData =
  | { type: "api"; auth: ApiKeyAuth; model: ApiKeyModelConfig }
  | { type: "codex"; auth: OAuthLoadedAuth; model: CodexModelConfig };

export const run: Compiler<ModelData> = async params => {
  const result = await (async () => {
    const modelData = params.model;

    if (modelData.type === "codex") {
      return runResponsesAgent({
        ...params,
        model: codexCompilerModel(modelData.model, modelData.auth),
      });
    }

    if (modelData.model.type == null || modelData.model.type === "standard") {
      return runAgent({
        ...params,
        model: standardOpenAICompilerModel(modelData.model, modelData.auth.apiKey),
      });
    }

    if (modelData.model.type === "openai-responses") {
      return runResponsesAgent({
        ...params,
        model: responsesOpenAICompilerModel(modelData.model, modelData.auth.apiKey),
      });
    }

    const _: "anthropic" = modelData.model.type;
    return runAnthropicAgent({
      ...params,
      model: anthropicCompilerModel(modelData.model, modelData.auth.apiKey),
    });
  })();

  trackCompilerResultUsage(params.model.model.model, result);
  return result;
};

function trackCompilerResultUsage<A extends Agent<any, any, any>, Tools>(
  model: string,
  result: CompilerResult<A, Tools>,
): void {
  const usage = compilerResultUsage(result);
  if (!usage || !compilerUsageHasTokens(usage)) return;
  trackTokens(model, "input", usage.input.total);
  trackTokens(model, "output", usage.output);
}

function compilerResultUsage<A extends Agent<any, any, any>, Tools>(
  result: CompilerResult<A, Tools>,
): CompilerUsage | undefined {
  if (result.success) return result.data.usage;
  if ("usage" in result.error) return result.error.usage;
  return undefined;
}

function compilerModalities(model: ModelConfig): CompilerModalities {
  return ["text", ...(model.modalities?.image?.enabled ? (["vision"] as const) : [])];
}

function standardOpenAICompilerModel(
  model: ApiKeyModelConfig,
  apiKey: string,
): OpenAICompilerModel {
  return {
    client: getDefaultOpenaiClient({ baseUrl: model.baseUrl, apiKey }),
    model: model.model,
    reasoningEffort: model.reasoning,
    modalities: compilerModalities(model),
  };
}

function responsesOpenAICompilerModel(
  model: ApiKeyModelConfig,
  apiKey: string,
): OpenAICompilerModel {
  return {
    client: getDefaultOpenaiClient({ baseUrl: model.baseUrl, apiKey }),
    model: model.model,
    reasoningEffort: model.reasoning,
    modalities: compilerModalities(model),
  };
}

function codexCompilerModel(model: CodexModelConfig, auth: OAuthLoadedAuth): OpenAICompilerModel {
  return {
    client: getCodexOpenaiClient({
      oauthToken: auth.oauthToken,
      accountId: auth.accountId,
    }),
    model: model.model,
    reasoningEffort: model.reasoning,
    modalities: compilerModalities(model),
  };
}

function anthropicCompilerModel(model: ApiKeyModelConfig, apiKey: string): AnthropicCompilerModel {
  const reasoningConfig = anthropicReasoningConfig(model.model, model.reasoning);
  const thinkingBudget =
    reasoningConfig.thinking?.type === "enabled" ? reasoningConfig.thinking.budget_tokens : 0;
  // TODO: allow this to be configurable. It's set to 32000 because that's Claude 4.1 Opus's max.
  const maxTokens = Math.min(32 * 1000 - thinkingBudget, model.context);
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
    ...reasoningConfig,
    modalities: compilerModalities(model),
  };
}

export function anthropicReasoningConfig(
  model: string,
  reasoning: ModelConfig["reasoning"],
): Pick<AnthropicCompilerModel, "thinking" | "outputConfig"> {
  if (reasoning == null) return {};

  const majorVersion = Number.parseInt(model.match(/\d+/)?.[0] ?? "", 10);
  if (majorVersion >= 5) {
    return {
      thinking: { type: "adaptive", display: "summarized" },
      outputConfig: { effort: reasoning },
    };
  }

  return { thinking: legacyAnthropicThinking(reasoning) };
}

function legacyAnthropicThinking(
  reasoning: NonNullable<ModelConfig["reasoning"]>,
): AnthropicCompilerModel["thinking"] {
  if (reasoning === "xhigh") return { type: "enabled", budget_tokens: 16384 };
  if (reasoning === "high") return { type: "enabled", budget_tokens: 8192 };
  if (reasoning === "medium") return { type: "enabled", budget_tokens: 4096 };
  return { type: "enabled", budget_tokens: 2048 };
}
