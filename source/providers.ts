export type ProviderConfig = {
  type?: "standard" | "openai-responses" | "anthropic",
  name: string;
  envVar: string;
  baseUrl: string;
  models: Array<{
    model: string;
    nickname: string;
    context: number;
    reasoning?: "low" | "medium" | "high";
  }>;
  testModel: string;
};

export const PROVIDERS = {
  openai: {
    type: "openai-responses",
    name: "OpenAI",
    envVar: "OPENAI_API_KEY",
    baseUrl: "https://api.openai.com/v1",
    models: [
      { model: "gpt-5-2025-08-07", nickname: "GPT-5", context: 128 * 1024, reasoning: "medium" },
      { model: "gpt-4.1-2025-04-14", nickname: "GPT-4.1", context: 64 * 1024 },
      { model: "o3-2025-04-16", nickname: "o3", context: 128 * 1024, reasoning: "medium" },
    ],
    testModel: "gpt-4.1-2025-04-14",
  } satisfies ProviderConfig,

  synthetic: {
    name: "Synthetic",
    envVar: "SYNTHETIC_API_KEY",
    baseUrl: "https://api.synthetic.new/v1",
    models: [
      {
        model: "hf:zai-org/GLM-4.5",
        nickname: "GLM-4.5",
        context: 64 * 1024,
      },
      {
        model: "hf:moonshotai/Kimi-K2-Instruct-0905",
        nickname: "Kimi K2 0905",
        context: 128 * 1024,
      },
      {
        model: "hf:deepseek-ai/DeepSeek-V3.1",
        nickname: "DeepSeek V3.1",
        context: 64 * 1024,
      },
      {
        model: "hf:openai/gpt-oss-120b",
        nickname: "GPT-OSS-120b",
        context: 64 * 1024,
      },
    ],
    testModel: "hf:openai/gpt-oss-120b",
  } satisfies ProviderConfig,


  anthropic: {
    type: "anthropic",
    name: "Anthropic",
    envVar: "ANTHROPIC_API_KEY",
    baseUrl: "https://api.anthropic.com",
    models: [
      {
        model: "claude-sonnet-4-20250514",
        nickname: "Claude 4 Sonnet",
        context: 64 * 1024,
        reasoning: "medium",
      },
      {
        model: "claude-opus-4-1-20250805",
        nickname: "Claude 4.1 Opus",
        context: 64 * 1024,
        reasoning: "medium",
      },
    ],
    testModel: "claude-sonnet-4-20250514",
  } satisfies ProviderConfig,

  grok: {
    name: "xAI",
    envVar: "XAI_API_KEY",
    baseUrl: "https://api.x.ai/v1",
    models: [
      { model: "grok-4-latest", nickname: "Grok 4", context: 64 * 1024 },
    ],
    testModel: "grok-4-latest",
  } satisfies ProviderConfig,
};

export type ProviderKey = keyof typeof PROVIDERS;

export const SYNTHETIC_PROVIDER = PROVIDERS.synthetic;

export function keyFromName(name: string): keyof typeof PROVIDERS {
  for(const [key, value] of Object.entries(PROVIDERS)) {
    if(value.name === name) return key as keyof typeof PROVIDERS;
  }
  throw new Error(`No provider named ${name} found`);
}

export function providerForBaseUrl(baseUrl: string): (typeof PROVIDERS)[keyof (typeof PROVIDERS)] | null {
  const provider = Object.values(PROVIDERS).find(p => p.baseUrl === baseUrl);
  if(provider == null) return null;
  return provider;
}
