use octofriend_tools::mcp::{
    ModelContextResourceContents, ModelContextToolResult, ModelContextToolResultContent,
    RenderedModelContextToolResult, render_model_context_tool_result,
};

#[test]
fn renders_text_media_links_and_resources_from_model_context_tool_results() {
    let result = render_model_context_tool_result(
        &ModelContextToolResult {
            content: vec![
                ModelContextToolResultContent::Text {
                    text: "plain text".into(),
                },
                ModelContextToolResultContent::Image {
                    mime_type: "image/png".into(),
                    data: "abcdef".into(),
                },
                ModelContextToolResultContent::Audio {
                    mime_type: "audio/wav".into(),
                    data: "abcd".into(),
                },
                ModelContextToolResultContent::ResourceLink {
                    uri: "file:///tmp/a.txt".into(),
                    mime_type: Some("text/plain".into()),
                },
                ModelContextToolResultContent::ResourceText {
                    resource: ModelContextResourceContents {
                        uri: "file:///tmp/b.txt".into(),
                        mime_type: None,
                    },
                    text: "resource text".into(),
                },
                ModelContextToolResultContent::ResourceText {
                    resource: ModelContextResourceContents {
                        uri: "file:///tmp/doc.xml".into(),
                        mime_type: Some("text/xml".into()),
                    },
                    text: "<documentation />".into(),
                },
                ModelContextToolResultContent::ResourceBlob {
                    resource: ModelContextResourceContents {
                        uri: "file:///tmp/c.bin".into(),
                        mime_type: Some("application/octet-stream".into()),
                    },
                    blob: "12345".into(),
                },
            ],
        },
        100,
    );

    assert_eq!(
        result,
        RenderedModelContextToolResult::Success {
            output: "plain text\n[Image: image/png, 6 bytes]\n[Audio: audio/wav, 4 bytes]\n[Resource Link: file:///tmp/a.txt (text/plain)]\n[Resource: file:///tmp/b.txt]\nresource text\n[Resource: file:///tmp/doc.xml (text/xml)]\n<documentation />\n[Resource: file:///tmp/c.bin (application/octet-stream)]\n[Binary data: 5 bytes]".into(),
        }
    );
}

#[test]
fn rejects_oversized_text_content() {
    assert_eq!(
        render_model_context_tool_result(
            &ModelContextToolResult {
                content: vec![ModelContextToolResultContent::Text {
                    text: "abcdef".into(),
                }],
            },
            5,
        ),
        RenderedModelContextToolResult::Error {
            error: "Text content too large: 6 bytes (max: 5 bytes)".into(),
        }
    );
}

#[test]
fn rejects_oversized_resource_text_content() {
    assert_eq!(
        render_model_context_tool_result(
            &ModelContextToolResult {
                content: vec![ModelContextToolResultContent::ResourceText {
                    resource: ModelContextResourceContents {
                        uri: "file:///tmp/a.txt".into(),
                        mime_type: None,
                    },
                    text: "abcdef".into(),
                }],
            },
            5,
        ),
        RenderedModelContextToolResult::Error {
            error: "Resource text content too large: 6 bytes (max: 5 bytes)".into(),
        }
    );
}
