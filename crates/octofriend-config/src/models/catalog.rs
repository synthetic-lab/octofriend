use std::fmt;

use serde_json::{Map, Value};

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
    Max,
    Ultra,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProviderAuthMethod {
    ApiKey,
    ChatGptOAuth,
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
pub struct ProviderConnectionConfig {
    pub env_var: &'static str,
    pub base_url: &'static str,
    pub base_url_aliases: &'static [&'static str],
    pub api_key_url: &'static str,
    pub auth_methods: &'static [ProviderAuthMethod],
    pub test_model: &'static str,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProviderConfig {
    pub key: ProviderKey,
    pub shortcut: char,
    pub kind: ProviderKind,
    pub name: &'static str,
    pub connection: ProviderConnectionConfig,
    pub models: &'static [ProviderModelConfig],
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

pub const API_KEY_AUTH: &[ProviderAuthMethod] = &[ProviderAuthMethod::ApiKey];
pub const OPENAI_AUTH: &[ProviderAuthMethod] =
    &[ProviderAuthMethod::ChatGptOAuth, ProviderAuthMethod::ApiKey];
pub const NO_BASE_URL_ALIASES: &[&str] = &[];
pub const SYNTHETIC_BASE_URL_ALIASES: &[&str] = &[
    "https://api.synthetic.new/openai/v1",
    "https://synthetic.new/api/openai/v1",
    "https://api.glhf.chat/v1",
    "https://glhf.chat/api/v1",
    "https://glhf.chat/api/openai/v1",
];

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
    openai_model("gpt-5.6-sol", "GPT-5.6-Sol", 372_000, ReasoningLevel::Low),
    openai_model(
        "gpt-5.6-terra",
        "GPT-5.6-Terra",
        372_000,
        ReasoningLevel::Medium,
    ),
    openai_model(
        "gpt-5.6-luna",
        "GPT-5.6-Luna",
        372_000,
        ReasoningLevel::Medium,
    ),
    openai_model("gpt-5.5", "GPT-5.5", 272_000, ReasoningLevel::Medium),
    openai_model("gpt-5.4", "GPT-5.4", 272_000, ReasoningLevel::Medium),
    openai_model(
        "gpt-5.4-mini",
        "GPT-5.4-Mini",
        272_000,
        ReasoningLevel::Medium,
    ),
    openai_model("gpt-5.2", "GPT-5.2", 272_000, ReasoningLevel::Medium),
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
        connection: ProviderConnectionConfig {
            env_var: "SYNTHETIC_API_KEY",
            base_url: "https://api.synthetic.new/v1",
            base_url_aliases: SYNTHETIC_BASE_URL_ALIASES,
            api_key_url: "https://dev.synthetic.new/",
            auth_methods: API_KEY_AUTH,
            test_model: "hf:MiniMaxAI/MiniMax-M2.1",
        },
        models: SYNTHETIC_MODELS,
    },
    ProviderConfig {
        key: ProviderKey::OpenAi,
        shortcut: 'o',
        kind: ProviderKind::OpenAiResponses,
        name: "OpenAI",
        connection: ProviderConnectionConfig {
            env_var: "OPENAI_API_KEY",
            base_url: "https://api.openai.com/v1",
            base_url_aliases: NO_BASE_URL_ALIASES,
            api_key_url: "https://platform.openai.com/api-keys",
            auth_methods: OPENAI_AUTH,
            test_model: "gpt-5.4-mini",
        },
        models: OPENAI_MODELS,
    },
    ProviderConfig {
        key: ProviderKey::Anthropic,
        shortcut: 'a',
        kind: ProviderKind::Anthropic,
        name: "Anthropic",
        connection: ProviderConnectionConfig {
            env_var: "ANTHROPIC_API_KEY",
            base_url: "https://api.anthropic.com",
            base_url_aliases: NO_BASE_URL_ALIASES,
            api_key_url: "https://console.anthropic.com/settings/keys",
            auth_methods: API_KEY_AUTH,
            test_model: "claude-haiku-4-5-20251001",
        },
        models: ANTHROPIC_MODELS,
    },
    ProviderConfig {
        key: ProviderKey::Gemini,
        shortcut: 'g',
        kind: ProviderKind::Gemini,
        name: "Google Gemini",
        connection: ProviderConnectionConfig {
            env_var: "GEMINI_API_KEY",
            base_url: "https://generativelanguage.googleapis.com/v1beta",
            base_url_aliases: NO_BASE_URL_ALIASES,
            api_key_url: "https://aistudio.google.com/apikey",
            auth_methods: API_KEY_AUTH,
            test_model: "gemini-3.5-flash",
        },
        models: GEMINI_MODELS,
    },
    ProviderConfig {
        key: ProviderKey::Grok,
        shortcut: 'x',
        kind: ProviderKind::Standard,
        name: "xAI",
        connection: ProviderConnectionConfig {
            env_var: "XAI_API_KEY",
            base_url: "https://api.x.ai/v1",
            base_url_aliases: NO_BASE_URL_ALIASES,
            api_key_url: "https://console.x.ai/",
            auth_methods: API_KEY_AUTH,
            test_model: "grok-4.3",
        },
        models: GROK_MODELS,
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
    PROVIDERS.iter().find(|provider| {
        base_urls_match(provider.connection.base_url, base_url)
            || provider
                .connection
                .base_url_aliases
                .iter()
                .any(|alias| base_urls_match(alias, base_url))
    })
}

pub fn provider_for_type(provider_type: &str) -> Option<&'static ProviderConfig> {
    match provider_type {
        "openai-responses" => Some(provider_for_key(ProviderKey::OpenAi)),
        "anthropic" => Some(provider_for_key(ProviderKey::Anthropic)),
        "gemini" => Some(provider_for_key(ProviderKey::Gemini)),
        _ => None,
    }
}

pub fn provider_for_model_object(object: &Map<String, Value>) -> Option<&'static ProviderConfig> {
    if let Some(provider) = object
        .get("type")
        .and_then(Value::as_str)
        .filter(|provider_type| *provider_type != "standard")
        .and_then(provider_for_type)
    {
        return Some(provider);
    }
    object
        .get("baseUrl")
        .and_then(Value::as_str)
        .and_then(provider_for_base_url)
        .or_else(|| {
            object
                .get("model")
                .and_then(Value::as_str)
                .and_then(provider_for_model_name)
        })
}

pub fn provider_for_model_name(model_name: &str) -> Option<&'static ProviderConfig> {
    PROVIDERS.iter().find(|provider| {
        provider
            .models
            .iter()
            .any(|model| model.model == model_name)
    })
}

pub fn base_urls_match(left: &str, right: &str) -> bool {
    normalize_base_url(left) == normalize_base_url(right)
}

fn normalize_base_url(mut base_url: &str) -> &str {
    base_url = base_url.trim();
    while base_url.len() > 1 && base_url.ends_with('/') {
        base_url = &base_url[..base_url.len() - 1];
    }
    base_url
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
    reasoning: ReasoningLevel,
) -> ProviderModelConfig {
    ProviderModelConfig {
        model,
        nickname,
        context,
        reasoning: Some(reasoning),
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
