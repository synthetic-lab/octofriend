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
import { getCodexOpenaiClient, getDefaultOpenaiClient } from "./openai.ts";
import { trackTokens } from "../token-tracker.ts";
import type { LoweredIR } from "../libocto/llm-ir.ts";
import type toolMap from "../tools/tool-defs/index.ts";

export type ModelData =
  | { type: "api"; auth: ApiKeyAuth; model: ApiKeyModelConfig }
  | { type: "codex"; auth: OAuthLoadedAuth; model: CodexModelConfig };

type RunArgs<Tools extends Partial<LoadedTools> | undefined = undefined> = {
  modelData: ModelData;
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

export async function run<Tools extends Partial<LoadedTools> | undefined = undefined>(
  args: RunArgs<Tools>,
): Promise<CompilerResult<typeof octoAgent, Tools>> {
  const result = await (async () => {
    const { modelData } = args;
    const params = {
      abortSignal: args.abortSignal,
      systemPrompt: args.systemPrompt,
      irs: args.messages,
      onTokens: args.handlers.onTokens,
      autofixJson: (badJson: string, signal: AbortSignal) => {
        const fixPromise = args.autofixJson(badJson, signal);
        args.handlers.onAutofixJson(fixPromise.then(() => {}));
        return fixPromise;
      },
      tools: args.tools,
      transport: args.transport,
    };

    if (modelData.type === "codex") {
      return runResponsesAgent<typeof octoAgent, Tools>({
        ...params,
        model: codexCompilerModel(modelData.model, modelData.auth),
      });
    }

    if (modelData.model.type == null || modelData.model.type === "standard") {
      return runAgent<typeof octoAgent, Tools>({
        ...params,
        model: standardOpenAICompilerModel(modelData.model, modelData.auth.apiKey),
      });
    }

    if (modelData.model.type === "openai-responses") {
      return runResponsesAgent<typeof octoAgent, Tools>({
        ...params,
        model: responsesOpenAICompilerModel(modelData.model, modelData.auth.apiKey),
      });
    }

    const _: "anthropic" = modelData.model.type;
    return runAnthropicAgent<typeof octoAgent, Tools>({
      ...params,
      model: anthropicCompilerModel(modelData.model, modelData.auth.apiKey),
    });
  })();

  trackCompilerResultUsage(args.modelData.model.model, result);
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
  if (reasoning === "xhigh") return { type: "enabled", budget_tokens: 16384 };
  if (reasoning === "high") return { type: "enabled", budget_tokens: 8192 };
  if (reasoning === "medium") return { type: "enabled", budget_tokens: 4096 };
  return { type: "enabled", budget_tokens: 2048 };
}
