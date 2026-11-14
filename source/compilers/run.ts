import {
  compilerUsageHasTokens,
  runAgent,
  runAnthropicAgent,
  runResponsesAgent,
  type Agent,
  type AnthropicBackend,
  type Compiler,
  type CompilerResult,
  type CompilerUsage,
  type OpenAIBackend,
} from "../libocto/index.ts";
import Anthropic from "@anthropic-ai/sdk";
import { APP_METADATA, ModelConfig } from "../config.ts";
import type {
  ApiKeyAuth,
  ApiKeyModelConfig,
  CodexModelConfig,
  OAuthLoadedAuth,
} from "../config.ts";
import { getCodexOpenaiClient, getDefaultOpenaiClient } from "./openai.ts";
import { trackTokens } from "../token-tracker.ts";

export type Backend =
  | { type: "api"; auth: ApiKeyAuth; model: ApiKeyModelConfig }
  | { type: "codex"; auth: OAuthLoadedAuth; model: CodexModelConfig };

export const run: Compiler<Backend> = async params => {
  const result = await (async () => {
    const backend = params.backend;

    if (backend.type === "codex") {
      return runResponsesAgent({
        ...params,
        backend: codexBackend(backend.model, backend.auth),
      });
    }

    if (backend.model.type == null || backend.model.type === "standard") {
      return runAgent({
        ...params,
        backend: standardOpenAIBackend(backend.model, backend.auth.apiKey),
      });
    }

    if (backend.model.type === "openai-responses") {
      return runResponsesAgent({
        ...params,
        backend: responsesOpenAIBackend(backend.model, backend.auth.apiKey),
      });
    }

    const _: "anthropic" = backend.model.type;
    return runAnthropicAgent({
      ...params,
      backend: anthropicBackend(backend.model, backend.auth.apiKey),
    });
  })();

  trackCompilerResultUsage(params.model.model, result);
  return result;
};

function trackCompilerResultUsage<A extends Agent<any, any, any, any>, Tools>(
  model: string,
  result: CompilerResult<A, Tools>,
): void {
  const usage = compilerResultUsage(result);
  if (!usage || !compilerUsageHasTokens(usage)) return;
  trackTokens(model, "input", usage.input.total);
  trackTokens(model, "output", usage.output);
}

function compilerResultUsage<A extends Agent<any, any, any, any>, Tools>(
  result: CompilerResult<A, Tools>,
): CompilerUsage | undefined {
  if (result.success) return result.data.usage;
  if ("usage" in result.error) return result.error.usage;
  return undefined;
}

function standardOpenAIBackend(model: ApiKeyModelConfig, apiKey: string): OpenAIBackend {
  return {
    client: getDefaultOpenaiClient({ baseUrl: model.baseUrl, apiKey }),
    reasoningEffort: model.reasoning,
  };
}

function responsesOpenAIBackend(model: ApiKeyModelConfig, apiKey: string): OpenAIBackend {
  return {
    client: getDefaultOpenaiClient({ baseUrl: model.baseUrl, apiKey }),
    reasoningEffort: model.reasoning,
  };
}

function codexBackend(model: CodexModelConfig, auth: OAuthLoadedAuth): OpenAIBackend {
  return {
    client: getCodexOpenaiClient({
      oauthToken: auth.oauthToken,
      accountId: auth.accountId,
    }),
    reasoningEffort: model.reasoning,
  };
}

function anthropicBackend(model: ApiKeyModelConfig, apiKey: string): AnthropicBackend {
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
    maxTokens,
    ...reasoningConfig,
  };
}

export function anthropicReasoningConfig(
  model: string,
  reasoning: ModelConfig["reasoning"],
): Pick<AnthropicBackend, "thinking" | "outputConfig"> {
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
): AnthropicBackend["thinking"] {
  if (reasoning === "xhigh") return { type: "enabled", budget_tokens: 16384 };
  if (reasoning === "high") return { type: "enabled", budget_tokens: 8192 };
  if (reasoning === "medium") return { type: "enabled", budget_tokens: 4096 };
  return { type: "enabled", budget_tokens: 2048 };
}
