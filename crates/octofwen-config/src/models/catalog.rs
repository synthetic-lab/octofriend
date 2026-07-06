use std::fmt;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProviderKind {
    Standard,
    OpenAiResponses,
    Anthropic,
    Gemini,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReasoningLevel {
    None,
    Minimal,
    Low,
    Medium,
    High,
    XHigh,
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
    pub api_key_url: &'static str,
    pub models: &'static [ProviderModelConfig],
    pub test_model: &'static str,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProviderKey {
    Synthetic,
    OpenAi,
    Anthropic,
    Gemini,
    Grok,
}

impl ProviderKey {
    pub const fn as_config_key(self) -> &'static str {
        match self {
            Self::Synthetic => "synthetic",
            Self::OpenAi => "openai",
            Self::Anthropic => "anthropic",
            Self::Gemini => "gemini",
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
    openai_model("gpt-5.5", "GPT-5.5", 1_000_000),
    openai_model("gpt-5.5-pro", "GPT-5.5 Pro", 1_000_000),
    openai_model("gpt-5.4", "GPT-5.4", 1_000_000),
    openai_model("gpt-5.4-mini", "GPT-5.4 Mini", 400_000),
];

pub const ANTHROPIC_MODELS: &[ProviderModelConfig] = &[
    anthropic_model("claude-fable-5", "Claude Fable 5", 1_000_000, None),
    anthropic_model(
        "claude-opus-4-8",
        "Claude 4.8 Opus",
        1_000_000,
        Some(ReasoningLevel::XHigh),
    ),
    anthropic_model(
        "claude-sonnet-5",
        "Claude Sonnet 5",
        1_000_000,
        Some(ReasoningLevel::High),
    ),
    anthropic_model(
        "claude-haiku-4-5",
        "Claude 4.5 Haiku",
        200 * 1000,
        Some(ReasoningLevel::Medium),
    ),
];

pub const GROK_MODELS: &[ProviderModelConfig] = &[ProviderModelConfig {
    model: "grok-4.3",
    nickname: "Grok 4.3",
    context: 1_000_000,
    reasoning: Some(ReasoningLevel::Low),
    modalities: Some(MultimodalConfig {
        image: Some(ImageModalityConfig {
            enabled: true,
            max_size_mb: 20,
            accepted_mime_types: IMAGE_JPEG_PNG,
        }),
    }),
}];

pub const GEMINI_MODELS: &[ProviderModelConfig] = &[gemini_model(
    "gemini-3.5-flash",
    "Gemini 3.5 Flash",
    1_048_576,
)];

pub const PROVIDERS: &[ProviderConfig] = &[
    ProviderConfig {
        key: ProviderKey::Synthetic,
        shortcut: 's',
        kind: ProviderKind::Standard,
        name: "Synthetic",
        env_var: "SYNTHETIC_API_KEY",
        base_url: "https://api.synthetic.new/v1",
        api_key_url: "https://dev.synthetic.new/",
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
        api_key_url: "https://platform.openai.com/api-keys",
        models: OPENAI_MODELS,
        test_model: "gpt-5.4-mini",
    },
    ProviderConfig {
        key: ProviderKey::Anthropic,
        shortcut: 'a',
        kind: ProviderKind::Anthropic,
        name: "Anthropic",
        env_var: "ANTHROPIC_API_KEY",
        base_url: "https://api.anthropic.com",
        api_key_url: "https://console.anthropic.com/settings/keys",
        models: ANTHROPIC_MODELS,
        test_model: "claude-haiku-4-5-20251001",
    },
    ProviderConfig {
        key: ProviderKey::Gemini,
        shortcut: 'g',
        kind: ProviderKind::Gemini,
        name: "Google Gemini",
        env_var: "GEMINI_API_KEY",
        base_url: "https://generativelanguage.googleapis.com/v1beta",
        api_key_url: "https://aistudio.google.com/apikey",
        models: GEMINI_MODELS,
        test_model: "gemini-3.5-flash",
    },
    ProviderConfig {
        key: ProviderKey::Grok,
        shortcut: 'x',
        kind: ProviderKind::Standard,
        name: "xAI",
        env_var: "XAI_API_KEY",
        base_url: "https://api.x.ai/v1",
        api_key_url: "https://console.x.ai/",
        models: GROK_MODELS,
        test_model: "grok-4.3",
    },
];

pub const SYNTHETIC_PROVIDER: &ProviderConfig = &PROVIDERS[0];
pub const DEFAULT_MULTIMODAL_IMAGE_MODEL_EXAMPLE: &str = "Kimi K2.5";

pub const fn recommended_model(provider: ProviderKey) -> &'static ProviderModelConfig {
    match provider {
        ProviderKey::Synthetic => &SYNTHETIC_MODELS[0],
        ProviderKey::OpenAi => &OPENAI_MODELS[0],
        ProviderKey::Anthropic => &ANTHROPIC_MODELS[0],
        ProviderKey::Gemini => &GEMINI_MODELS[0],
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
        ProviderKey::Gemini => &PROVIDERS[3],
        ProviderKey::Grok => &PROVIDERS[4],
    }
}

const fn openai_model(
    model: &'static str,
    nickname: &'static str,
    context: u32,
) -> ProviderModelConfig {
    ProviderModelConfig {
        model,
        nickname,
        context,
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

const fn anthropic_model(
    model: &'static str,
    nickname: &'static str,
    context: u32,
    reasoning: Option<ReasoningLevel>,
) -> ProviderModelConfig {
    ProviderModelConfig {
        model,
        nickname,
        context,
        reasoning,
        modalities: Some(MultimodalConfig {
            image: Some(ImageModalityConfig {
                enabled: true,
                max_size_mb: 30,
                accepted_mime_types: IMAGE_JPEG_PNG_WEBP_GIF,
            }),
        }),
    }
}

const fn gemini_model(
    model: &'static str,
    nickname: &'static str,
    context: u32,
) -> ProviderModelConfig {
    ProviderModelConfig {
        model,
        nickname,
        context,
        reasoning: Some(ReasoningLevel::Low),
        modalities: Some(MultimodalConfig {
            image: Some(ImageModalityConfig {
                enabled: true,
                max_size_mb: 20,
                accepted_mime_types: IMAGE_JPEG_PNG_WEBP_GIF,
            }),
        }),
    }
}
