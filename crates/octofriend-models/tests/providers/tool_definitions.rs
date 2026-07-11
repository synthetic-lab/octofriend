use octofriend_models::providers::tool_definitions::{
    ProviderToolDefinition, ProviderToolDefinitionTarget, provider_tool_definitions_json,
};
use serde_json::json;

#[test]
fn shapes_openai_chat_completions_tool_definitions() {
    assert_eq!(
        provider_tool_definitions_json(
            ProviderToolDefinitionTarget::OpenAiChatCompletions,
            Some(vec![ProviderToolDefinition {
                name: "read".into(),
                description: "Read a file".into(),
                schema: json!({
                    "$schema": "https://json-schema.org/draft/2020-12/schema",
                    "title": "ReadArgs",
                    "description": "Read args",
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" }
                    },
                    "required": ["path"]
                }),
            }]),
        ),
        Some(json!([{
            "type": "function",
            "function": {
                "name": "read",
                "description": "Read a file",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" }
                    },
                    "required": ["path"]
                },
                "strict": true
            }
        }]))
    );
}

#[test]
fn shapes_openai_responses_tool_definitions_with_strict_schema() {
    assert_eq!(
        provider_tool_definitions_json(
            ProviderToolDefinitionTarget::OpenAiResponses,
            Some(vec![ProviderToolDefinition {
                name: "search".into(),
                description: "Search files".into(),
                schema: json!({
                    "type": "object",
                    "required": ["query"],
                    "properties": {
                        "query": { "type": "string" },
                        "limit": { "type": "number" },
                        "mode": { "enum": ["files", "symbols"] }
                    }
                }),
            }]),
        ),
        Some(json!([{
            "type": "function",
            "name": "search",
            "description": "Search files",
            "parameters": {
                "type": "object",
                "required": ["limit", "mode", "query"],
                "properties": {
                    "query": { "type": "string" },
                    "limit": { "type": ["number", "null"] },
                    "mode": {
                        "type": ["string", "null"],
                        "enum": ["files", "symbols"]
                    }
                },
                "additionalProperties": false
            },
            "strict": true
        }]))
    );
}

#[test]
fn shapes_anthropic_tool_definitions() {
    assert_eq!(
        provider_tool_definitions_json(
            ProviderToolDefinitionTarget::Anthropic,
            Some(vec![ProviderToolDefinition {
                name: "read".into(),
                description: "Read a file".into(),
                schema: json!({
                    "$schema": "https://json-schema.org/draft/2020-12/schema",
                    "title": "ReadArgs",
                    "description": "Read args",
                    "type": "object"
                }),
            }]),
        ),
        Some(json!([{
            "name": "read",
            "description": "Read a file",
            "input_schema": {
                "type": "object"
            }
        }]))
    );
}

#[test]
fn shapes_gemini_tool_definitions() {
    assert_eq!(
        provider_tool_definitions_json(
            ProviderToolDefinitionTarget::Gemini,
            Some(vec![ProviderToolDefinition {
                name: "read".into(),
                description: "Read a file".into(),
                schema: json!({
                    "$schema": "https://json-schema.org/draft/2020-12/schema",
                    "title": "ReadArgs",
                    "description": "Read args",
                    "type": "object",
                    "additionalProperties": false
                }),
            }]),
        ),
        Some(json!([{
            "functionDeclarations": [{
                "name": "read",
                "description": "Read a file",
                "parametersJsonSchema": {
                    "type": "object",
                    "additionalProperties": false
                }
            }]
        }]))
    );
}
