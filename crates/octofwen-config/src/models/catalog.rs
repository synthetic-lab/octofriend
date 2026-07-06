use std::fmt;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProviderKind {
    Standard,
    OpenAiResponses,
    Anthropic,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReasoningLevel {
    Low,
    Medium,
    High,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ImageModalityConfig {
    pub enabled: bool,
    pub max_size_mb: u32,
    pub accepted_mime_types: &'static [&'static str],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MultimodalConfig {
    pub image: Option<ImageModalityConfig>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProviderModelConfig {
    pub model: &'static str,
    pub nickname: &'static str,
    pub context: u32,
    pub reasoning: Option<ReasoningLevel>,
    pub modalities: Option<MultimodalConfig>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProviderConfig {
    pub key: ProviderKey,
    pub shortcut: char,
    pub kind: ProviderKind,
    pub name: &'static str,
    pub env_var: &'static str,
    pub base_url: &'static str,
    pub models: &'static [ProviderModelConfig],
    pub test_model: &'static str,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProviderKey {
    Synthetic,
    OpenAi,
    Anthropic,
    Grok,
}

impl ProviderKey {
    pub const fn as_config_key(self) -> &'static str {
        match self {
            Self::Synthetic => "synthetic",
            Self::OpenAi => "openai",
            Self::Anthropic => "anthropic",
            Self::Grok => "grok",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MissingProviderName {
    pub name: String,
}

impl fmt::Display for MissingProviderName {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "No provider named {} found", self.name)
    }
}

impl std::error::Error for MissingProviderName {}

pub const IMAGE_JPEG_PNG_WEBP_GIF: &[&str] =
    &["image/jpeg", "image/png", "image/webp", "image/gif"];
pub const IMAGE_JPEG_PNG: &[&str] = &["image/jpeg", "image/png"];

pub const SYNTHETIC_MODELS: &[ProviderModelConfig] = &[
    ProviderModelConfig {
        model: "hf:moonshotai/Kimi-K2.5",
        nickname: "Kimi K2.5",
        context: 256 * 1024,
        reasoning: None,
        modalities: Some(MultimodalConfig {
            image: Some(ImageModalityConfig {
                enabled: true,
                max_size_mb: 10,
                accepted_mime_types: IMAGE_JPEG_PNG_WEBP_GIF,
            }),
        }),
    },
    ProviderModelConfig {
        model: "hf:MiniMaxAI/MiniMax-M2.5",
        nickname: "MiniMax M2.5",
        context: 192 * 1024,
        reasoning: None,
        modalities: None,
    },
    ProviderModelConfig {
        model: "hf:zai-org/GLM-4.7",
        nickname: "GLM-4.7",
        context: 198 * 1024,
        reasoning: None,
        modalities: None,
    },
];

pub const OPENAI_MODELS: &[ProviderModelConfig] = &[
    openai_model("gpt-5.3-codex", "GPT-5.3 Codex"),
    openai_model("gpt-5.2-pro", "GPT-5.2 Pro"),
    openai_model("gpt-5.2", "GPT-5.2"),
    openai_model("gpt-5-mini", "GPT-5 Mini"),
];

pub const ANTHROPIC_MODELS: &[ProviderModelConfig] = &[
    anthropic_model("claude-sonnet-4-6", "Claude 4.5 Sonnet"),
    anthropic_model("claude-opus-4-6", "Claude 4.6 Opus"),
    anthropic_model("claude-haiku-4-5", "Claude 4.5 Haiku"),
];

pub const GROK_MODELS: &[ProviderModelConfig] = &[ProviderModelConfig {
    model: "grok-4-latest",
    nickname: "Grok 4",
    context: 64 * 1024,
    reasoning: None,
    modalities: Some(MultimodalConfig {
        image: Some(ImageModalityConfig {
            enabled: true,
            max_size_mb: 20,
            accepted_mime_types: IMAGE_JPEG_PNG,
        }),
    }),
}];

pub const PROVIDERS: &[ProviderConfig] = &[
    ProviderConfig {
        key: ProviderKey::Synthetic,
        shortcut: 's',
        kind: ProviderKind::Standard,
        name: "Synthetic",
        env_var: "SYNTHETIC_API_KEY",
        base_url: "https://api.synthetic.new/v1",
        models: SYNTHETIC_MODELS,
        test_model: "hf:MiniMaxAI/MiniMax-M2.1",
    },
    ProviderConfig {
        key: ProviderKey::OpenAi,
        shortcut: 'o',
        kind: ProviderKind::OpenAiResponses,
        name: "OpenAI",
        env_var: "OPENAI_API_KEY",
        base_url: "https://api.openai.com/v1",
        models: OPENAI_MODELS,
        test_model: "gpt-5-mini-2025-08-07",
    },
    ProviderConfig {
        key: ProviderKey::Anthropic,
        shortcut: 'a',
        kind: ProviderKind::Anthropic,
        name: "Anthropic",
        env_var: "ANTHROPIC_API_KEY",
        base_url: "https://api.anthropic.com",
        models: ANTHROPIC_MODELS,
        test_model: "claude-haiku-4-5-20251001",
    },
    ProviderConfig {
        key: ProviderKey::Grok,
        shortcut: 'x',
        kind: ProviderKind::Standard,
        name: "xAI",
        env_var: "XAI_API_KEY",
        base_url: "https://api.x.ai/v1",
        models: GROK_MODELS,
        test_model: "grok-4-latest",
    },
];

pub const SYNTHETIC_PROVIDER: &ProviderConfig = &PROVIDERS[0];
pub const DEFAULT_MULTIMODAL_IMAGE_MODEL_EXAMPLE: &str = "Kimi K2.5";

pub const fn recommended_model(provider: ProviderKey) -> &'static ProviderModelConfig {
    match provider {
        ProviderKey::Synthetic => &SYNTHETIC_MODELS[0],
        ProviderKey::OpenAi => &OPENAI_MODELS[0],
        ProviderKey::Anthropic => &ANTHROPIC_MODELS[0],
        ProviderKey::Grok => &GROK_MODELS[0],
    }
}

pub fn key_from_name(name: &str) -> Result<ProviderKey, MissingProviderName> {
    PROVIDERS
        .iter()
        .find(|provider| provider.name == name)
        .map(|provider| provider.key)
        .ok_or_else(|| MissingProviderName {
            name: name.to_owned(),
        })
}

pub fn provider_for_base_url(base_url: &str) -> Option<&'static ProviderConfig> {
    PROVIDERS
        .iter()
        .find(|provider| provider.base_url == base_url)
}

pub fn provider_for_key(key: ProviderKey) -> &'static ProviderConfig {
    match key {
        ProviderKey::Synthetic => &PROVIDERS[0],
        ProviderKey::OpenAi => &PROVIDERS[1],
        ProviderKey::Anthropic => &PROVIDERS[2],
        ProviderKey::Grok => &PROVIDERS[3],
    }
}

const fn openai_model(model: &'static str, nickname: &'static str) -> ProviderModelConfig {
    ProviderModelConfig {
        model,
        nickname,
        context: 200 * 1024,
        reasoning: Some(ReasoningLevel::Medium),
        modalities: Some(MultimodalConfig {
            image: Some(ImageModalityConfig {
                enabled: true,
                max_size_mb: 20,
                accepted_mime_types: IMAGE_JPEG_PNG_WEBP_GIF,
            }),
        }),
    }
}

const fn anthropic_model(model: &'static str, nickname: &'static str) -> ProviderModelConfig {
    ProviderModelConfig {
        model,
        nickname,
        context: 200 * 1000,
        reasoning: Some(ReasoningLevel::Medium),
        modalities: Some(MultimodalConfig {
            image: Some(ImageModalityConfig {
                enabled: true,
                max_size_mb: 30,
                accepted_mime_types: IMAGE_JPEG_PNG_WEBP_GIF,
            }),
        }),
    }
}
