use octofwen_models::providers::openai_responses_input_from_ts_ir;
use serde_json::json;

#[test]
fn lowers_typescript_ir_into_openai_responses_input() {
    let input = openai_responses_input_from_ts_ir(
        &[
            json!({
                "role": "user",
                "content": [
                    { "type": "text", "content": "hello" },
                    { "type": "image", "image": { "mimeType": "image/png", "dataUrl": "data:image/png;base64,abc" } }
                ]
            }),
            json!({
                "role": "assistant",
                "content": "answer",
                "reasoningContent": "why",
                "openai": { "reasoningId": "rs_1", "encryptedReasoningContent": "encrypted" },
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
                "role": "tool-runtime-error",
                "toolCall": { "toolCallId": "call-2" },
                "error": "boom"
            })
        ],
        Some(&["vision".into()]),
    )
    .expect("typescript ir should lower to responses input");

    assert_eq!(
        input,
        json!([
            {
                "role": "user",
                "content": [
                    { "type": "input_text", "text": "hello" },
                    { "type": "input_image", "detail": "auto", "image_url": "data:image/png;base64,abc" }
                ]
            },
            { "type": "reasoning", "id": "rs_1", "summary": [], "encrypted_content": "encrypted" },
            { "role": "assistant", "content": "answer" },
            { "type": "function_call", "call_id": "call-1", "name": "read", "arguments": "{\"path\":\"README.md\"}" },
            { "type": "function_call_output", "call_id": "call-1", "output": "contents" },
            { "type": "function_call_output", "call_id": "call-2", "output": "Error: boom" }
        ])
    );
}
