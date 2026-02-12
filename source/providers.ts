import { Hotkey } from "./components/kb-select/kb-shortcut-select.tsx";

export type ProviderConfig = {
  shortcut: Hotkey;
  type?: "standard" | "openai-responses" | "anthropic";
  name: string;
  envVar: string;
  baseUrl: string;
  models: Array<{
    model: string;
    nickname: string;
    context: number;
    reasoning?: "low" | "medium" | "high";
    multimodal?: boolean;
  }>;
  testModel: string;
};

export const PROVIDERS = {
  synthetic: {
    shortcut: "s" as const,
    name: "Synthetic",
    envVar: "SYNTHETIC_API_KEY",
    baseUrl: "https://api.synthetic.new/v1",
    models: [
      {
        model: "hf:nvidia/Kimi-K2.5-NVFP4",
        nickname: "Kimi K2.5 NVFP4",
        context: 256 * 1024,
        multimodal: true,
      },
      {
        model: "hf:zai-org/GLM-4.7",
        nickname: "GLM-4.7",
        context: 198 * 1024,
      },
      {
        model: "hf:moonshotai/Kimi-K2.5",
        nickname: "Kimi K2.5",
        context: 256 * 1024,
        multimodal: true,
      },
      {
        model: "hf:MiniMaxAI/MiniMax-M2.1",
        nickname: "MiniMax M2.1",
        context: 192 * 1024,
      },
      {
        model: "hf:openai/gpt-oss-120b",
        nickname: "GPT-OSS-120b",
        context: 128 * 1024,
      },
    ],
    testModel: "hf:MiniMaxAI/MiniMax-M2.1",
  } satisfies ProviderConfig,

  openai: {
    shortcut: "o" as const,
    type: "openai-responses",
    name: "OpenAI",
    envVar: "OPENAI_API_KEY",
    baseUrl: "https://api.openai.com/v1",
    models: [
      {
        model: "gpt-5.2-pro-2025-12-11",
        nickname: "GPT-5.2 Pro",
        context: 200 * 1024,
        reasoning: "medium",
      },
      {
        model: "gpt-5.2-2025-12-11",
        nickname: "GPT-5.2",
        context: 200 * 1024,
        reasoning: "medium",
      },
      {
        model: "gpt-5-mini-2025-08-07",
        nickname: "GPT-5 Mini",
        context: 200 * 1024,
        reasoning: "medium",
      },
    ],
    testModel: "gpt-5-mini-2025-08-07",
  } satisfies ProviderConfig,

  anthropic: {
    shortcut: "a" as const,
    type: "anthropic",
    name: "Anthropic",
    envVar: "ANTHROPIC_API_KEY",
    baseUrl: "https://api.anthropic.com",
    models: [
      {
        model: "claude-sonnet-4-5-20250929",
        nickname: "Claude 4.5 Sonnet",
        context: 200 * 1000,
        reasoning: "medium",
      },
      {
        model: "claude-opus-4-6",
        nickname: "Claude 4.6 Opus",
        context: 200 * 1000,
        reasoning: "medium",
      },
      {
        model: "claude-haiku-4-5-20251001",
        nickname: "Claude 4.5 Haiku",
        context: 200 * 1000,
        reasoning: "medium",
      },
    ],
    testModel: "claude-haiku-4-5-20251001",
  } satisfies ProviderConfig,

  grok: {
    shortcut: "x" as const,
    name: "xAI",
    envVar: "XAI_API_KEY",
    baseUrl: "https://api.x.ai/v1",
    models: [{ model: "grok-4-latest", nickname: "Grok 4", context: 64 * 1024 }],
    testModel: "grok-4-latest",
  } satisfies ProviderConfig,
};

export type ProviderKey = keyof typeof PROVIDERS;

export function recommendedModel(provider: ProviderKey): ProviderConfig["models"][number] {
  return PROVIDERS[provider].models[0];
}

export const SYNTHETIC_PROVIDER = PROVIDERS.synthetic;

export function keyFromName(name: string): keyof typeof PROVIDERS {
  for (const [key, value] of Object.entries(PROVIDERS)) {
    if (value.name === name) return key as keyof typeof PROVIDERS;
  }
  throw new Error(`No provider named ${name} found`);
}

export function providerForBaseUrl(
  baseUrl: string,
): (typeof PROVIDERS)[keyof typeof PROVIDERS] | null {
  const provider = Object.values(PROVIDERS).find(p => p.baseUrl === baseUrl);
  if (provider == null) return null;
  return provider;
}
