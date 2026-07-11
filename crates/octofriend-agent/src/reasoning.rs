use super::model_plan::ProviderReasoningParam;
use serde_json::{Value, json};

pub(super) fn openai_responses_reasoning(
    reasoning: Option<ProviderReasoningParam>,
) -> Option<Value> {
    reasoning.map(|effort| {
        json!({
            "effort": provider_reasoning_effort(effort),
            "summary": "auto",
        })
    })
}

pub(super) fn anthropic_thinking(
    model: &str,
    reasoning: Option<ProviderReasoningParam>,
    explicit_budget_tokens: Option<u64>,
    max_tokens: u64,
) -> Option<Value> {
    if anthropic_model_family(model, ANTHROPIC_ADAPTIVE_THINKING_FAMILIES) {
        return anthropic_adaptive_thinking(model, reasoning, explicit_budget_tokens);
    }

    explicit_budget_tokens
        .or_else(|| anthropic_thinking_budget(reasoning))
        .and_then(|budget_tokens| anthropic_valid_thinking_budget(budget_tokens, max_tokens))
        .map(|budget_tokens| {
            json!({
                "budget_tokens": budget_tokens,
                "type": "enabled",
            })
        })
}

fn anthropic_adaptive_thinking(
    model: &str,
    reasoning: Option<ProviderReasoningParam>,
    explicit_budget_tokens: Option<u64>,
) -> Option<Value> {
    match reasoning {
        Some(ProviderReasoningParam::None)
            if anthropic_model_family(model, ANTHROPIC_DISABLE_ADAPTIVE_THINKING_FAMILIES) =>
        {
            Some(json!({ "type": "disabled" }))
        }
        Some(ProviderReasoningParam::None) | None
            if anthropic_model_family(model, ANTHROPIC_ALWAYS_ON_ADAPTIVE_THINKING_FAMILIES) =>
        {
            None
        }
        None if explicit_budget_tokens.is_some() => Some(json!({ "type": "adaptive" })),
        Some(ProviderReasoningParam::None) | None => None,
        Some(_)
            if anthropic_model_family(model, ANTHROPIC_ALWAYS_ON_ADAPTIVE_THINKING_FAMILIES) =>
        {
            None
        }
        Some(_) => Some(json!({ "type": "adaptive" })),
    }
}

pub(super) fn anthropic_output_config(
    model: &str,
    reasoning: Option<ProviderReasoningParam>,
) -> Option<Value> {
    if !anthropic_model_family(model, ANTHROPIC_EFFORT_FAMILIES) {
        return None;
    }
    let reasoning = reasoning?;
    let effort = anthropic_effort(reasoning)?;
    Some(json!({ "effort": effort }))
}

fn anthropic_effort(reasoning: ProviderReasoningParam) -> Option<&'static str> {
    match reasoning {
        ProviderReasoningParam::XHigh | ProviderReasoningParam::Max | ProviderReasoningParam::Ultra => Some("xhigh"),
        ProviderReasoningParam::High => Some("high"),
        ProviderReasoningParam::Medium => Some("medium"),
        ProviderReasoningParam::Low | ProviderReasoningParam::Minimal => Some("low"),
        ProviderReasoningParam::None => None,
    }
}

const ANTHROPIC_ADAPTIVE_THINKING_FAMILIES: &[&str] = &[
    "claude-fable-5",
    "claude-mythos-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-sonnet-5",
];

const ANTHROPIC_ALWAYS_ON_ADAPTIVE_THINKING_FAMILIES: &[&str] =
    &["claude-fable-5", "claude-mythos-5"];

const ANTHROPIC_DISABLE_ADAPTIVE_THINKING_FAMILIES: &[&str] = &["claude-sonnet-5"];

const ANTHROPIC_EFFORT_FAMILIES: &[&str] = &[
    "claude-fable-5",
    "claude-mythos-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-opus-4-6",
    "claude-sonnet-5",
    "claude-sonnet-4-6",
    "claude-opus-4-5",
];

fn anthropic_model_family(model: &str, families: &[&str]) -> bool {
    families.iter().any(|family| {
        model == *family
            || model
                .strip_prefix(family)
                .is_some_and(|suffix| suffix.starts_with('-'))
    })
}

fn anthropic_valid_thinking_budget(budget_tokens: u64, max_tokens: u64) -> Option<u64> {
    if !(1024..max_tokens).contains(&budget_tokens) {
        return None;
    }
    Some(budget_tokens)
}

fn anthropic_thinking_budget(reasoning: Option<ProviderReasoningParam>) -> Option<u64> {
    Some(match reasoning? {
        ProviderReasoningParam::XHigh | ProviderReasoningParam::Max | ProviderReasoningParam::Ultra => 16_384,
        ProviderReasoningParam::High => 8192,
        ProviderReasoningParam::Medium => 4096,
        ProviderReasoningParam::Low => 2048,
        ProviderReasoningParam::Minimal => 1024,
        ProviderReasoningParam::None => return None,
    })
}

pub(super) fn gemini_generation_config(
    model: &str,
    reasoning: Option<ProviderReasoningParam>,
    explicit_budget_tokens: Option<u64>,
) -> Option<Value> {
    if let Some(budget_tokens) = explicit_budget_tokens {
        return Some(json!({
            "thinkingConfig": {
                "thinkingBudget": budget_tokens,
            },
        }));
    }

    let reasoning = reasoning?;
    let thinking_config = if gemini_model_family(model, "gemini-2.5") {
        json!({ "thinkingBudget": gemini_25_thinking_budget(model, reasoning)? })
    } else {
        gemini_thinking_level(reasoning)
    };
    Some(json!({ "thinkingConfig": thinking_config }))
}

fn gemini_thinking_level(reasoning: ProviderReasoningParam) -> Value {
    match reasoning {
        ProviderReasoningParam::None => json!({ "thinkingBudget": 0 }),
        ProviderReasoningParam::Minimal => json!({ "thinkingLevel": "minimal" }),
        ProviderReasoningParam::Low => json!({ "thinkingLevel": "low" }),
        ProviderReasoningParam::Medium => json!({ "thinkingLevel": "medium" }),
        ProviderReasoningParam::High | ProviderReasoningParam::XHigh | ProviderReasoningParam::Max | ProviderReasoningParam::Ultra => {
            json!({ "thinkingLevel": "high" })
        }
    }
}

fn gemini_25_thinking_budget(model: &str, reasoning: ProviderReasoningParam) -> Option<i64> {
    Some(match reasoning {
        ProviderReasoningParam::None if gemini_model_family(model, "gemini-2.5-pro") => {
            return None;
        }
        ProviderReasoningParam::None => 0,
        ProviderReasoningParam::Minimal => 512,
        ProviderReasoningParam::Low => 1024,
        ProviderReasoningParam::Medium => 4096,
        ProviderReasoningParam::High => 8192,
        ProviderReasoningParam::XHigh | ProviderReasoningParam::Max | ProviderReasoningParam::Ultra => 16_384,
    })
}

fn gemini_model_family(model: &str, family: &str) -> bool {
    model == family
        || model
            .strip_prefix(family)
            .is_some_and(|suffix| suffix.starts_with('-'))
}

fn provider_reasoning_effort(reasoning: ProviderReasoningParam) -> &'static str {
    match reasoning {
        ProviderReasoningParam::XHigh => "xhigh",
        ProviderReasoningParam::Max => "max",
        ProviderReasoningParam::Ultra => "ultra",
        ProviderReasoningParam::High => "high",
        ProviderReasoningParam::Medium => "medium",
        ProviderReasoningParam::Low => "low",
        ProviderReasoningParam::Minimal => "minimal",
        ProviderReasoningParam::None => "none",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_gemini_25_reasoning_to_thinking_budget() {
        assert_eq!(
            gemini_generation_config(
                "gemini-2.5-flash",
                Some(ProviderReasoningParam::XHigh),
                None
            ),
            Some(json!({ "thinkingConfig": { "thinkingBudget": 16_384 } }))
        );
        assert_eq!(
            gemini_generation_config("gemini-2.5-flash", Some(ProviderReasoningParam::None), None),
            Some(json!({ "thinkingConfig": { "thinkingBudget": 0 } }))
        );
    }

    #[test]
    fn omits_impossible_gemini_25_pro_none_reasoning() {
        assert_eq!(
            gemini_generation_config("gemini-2.5-pro", Some(ProviderReasoningParam::None), None),
            None
        );
    }

    #[test]
    fn maps_gemini_3_reasoning_to_thinking_level() {
        assert_eq!(
            gemini_generation_config(
                "gemini-3.5-flash",
                Some(ProviderReasoningParam::XHigh),
                None
            ),
            Some(json!({ "thinkingConfig": { "thinkingLevel": "high" } }))
        );
    }
}
