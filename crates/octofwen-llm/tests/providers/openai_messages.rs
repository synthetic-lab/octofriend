use octofwen_llm::providers::openai_chat_completions_messages_from_ts_ir;
use serde_json::json;

#[test]
fn lowers_typescript_ir_into_openai_chat_completion_messages() {
    let messages = openai_chat_completions_messages_from_ts_ir(
        &[
            json!({
                "role": "user",
                "content": [
                    { "type": "text", "content": "hello" },
                    { "type": "image", "image": { "dataUrl": "data:image/png;base64,abc" } }
                ]
            }),
            json!({
                "role": "assistant",
                "content": "answer",
                "reasoningContent": "because",
                "toolCalls": [{
                    "type": "tool-call",
                    "toolCallId": "call-1",
                    "name": "read",
                    "original": { "path": "README.md" }
                }]
            }),
            json!({
                "role": "tool-output",
                "toolCall": { "toolCallId": "call-1" },
                "content": [{ "type": "text", "content": "contents" }]
            }),
            json!({
                "role": "tool-validation-error",
                "toolCall": { "toolCallId": "call-2" },
                "error": "bad args"
            }),
        ],
        Some("system prompt"),
        Some(&["vision".into()]),
    )
    .expect("typescript ir should lower to openai chat messages");

    assert_eq!(
        messages,
        json!([
            { "role": "system", "content": "system prompt" },
            {
                "role": "user",
                "content": [
                    { "type": "text", "text": "hello" },
                    { "type": "image_url", "image_url": { "url": "data:image/png;base64,abc" } }
                ]
            },
            {
                "role": "assistant",
                "content": "answer",
                "reasoning_content": "because",
                "tool_calls": [{
                    "type": "function",
                    "function": { "name": "read", "arguments": "{\"path\":\"README.md\"}" },
                    "id": "call-1"
                }]
            },
            {
                "role": "tool",
                "tool_call_id": "call-1",
                "content": [{ "type": "text", "text": "contents" }]
            },
            {
                "role": "tool",
                "tool_call_id": "call-2",
                "content": [{ "type": "text", "text": "Error from tool call validation: <tool-runtime-error>bad args</tool-runtime-error>" }]
            }
        ])
    );
}

#[test]
fn lowers_unsupported_openai_chat_images_to_text_placeholders_without_vision_modality() {
    let messages = openai_chat_completions_messages_from_ts_ir(
        &[json!({
            "role": "lowered-checkpoint",
            "content": [{ "type": "image", "image": { "dataUrl": "data:image/png;base64,abc" } }]
        })],
        None,
        Some(&["text".into()]),
    )
    .expect("typescript ir should lower to openai chat messages");

    assert_eq!(
        messages,
        json!([{ "role": "user", "content": [{ "type": "text", "text": "[An image was attached here. Since images are not supported by your model, the source to the image is omitted. There might be future context that allows you to make a guess about what the image was, so keep that in mind as you process the rest of the messages.]" }] }])
    );
}
