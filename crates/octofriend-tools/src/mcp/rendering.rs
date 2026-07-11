#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ModelContextResourceContents {
    pub uri: String,
    pub mime_type: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ModelContextToolResultContent {
    Text {
        text: String,
    },
    Image {
        mime_type: String,
        data: String,
    },
    Audio {
        mime_type: String,
        data: String,
    },
    ResourceLink {
        uri: String,
        mime_type: Option<String>,
    },
    ResourceText {
        resource: ModelContextResourceContents,
        text: String,
    },
    ResourceBlob {
        resource: ModelContextResourceContents,
        blob: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ModelContextToolResult {
    pub content: Vec<ModelContextToolResultContent>,
}

impl Default for ModelContextToolResult {
    fn default() -> Self {
        Self {
            content: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RenderedModelContextToolResult {
    Success { output: String },
    Error { error: String },
}

pub fn render_model_context_tool_result(
    result: &ModelContextToolResult,
    max_content_bytes: usize,
) -> RenderedModelContextToolResult {
    if let Some(error) = find_model_context_size_error(&result.content, max_content_bytes) {
        return RenderedModelContextToolResult::Error { error };
    }

    RenderedModelContextToolResult::Success {
        output: result
            .content
            .iter()
            .map(format_model_context_content)
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .to_owned(),
    }
}

fn find_model_context_size_error(
    content: &[ModelContextToolResultContent],
    max_content_bytes: usize,
) -> Option<String> {
    content
        .iter()
        .find_map(|item| model_context_content_size_error(item, max_content_bytes))
}

fn model_context_content_size_error(
    content: &ModelContextToolResultContent,
    max_content_bytes: usize,
) -> Option<String> {
    match content {
        ModelContextToolResultContent::Text { text } if text.len() > max_content_bytes => {
            Some(format!(
                "Text content too large: {} bytes (max: {max_content_bytes} bytes)",
                text.len()
            ))
        }
        ModelContextToolResultContent::ResourceText { text, .. }
            if text.len() > max_content_bytes =>
        {
            Some(format!(
                "Resource text content too large: {} bytes (max: {max_content_bytes} bytes)",
                text.len()
            ))
        }
        _ => None,
    }
}

fn format_model_context_content(content: &ModelContextToolResultContent) -> String {
    match content {
        ModelContextToolResultContent::Text { text } => text.clone(),
        ModelContextToolResultContent::Image { mime_type, data } => {
            format!("[Image: {mime_type}, {} bytes]", data.len())
        }
        ModelContextToolResultContent::Audio { mime_type, data } => {
            format!("[Audio: {mime_type}, {} bytes]", data.len())
        }
        ModelContextToolResultContent::ResourceLink { uri, mime_type } => match mime_type {
            Some(mime_type) => format!("[Resource Link: {uri} ({mime_type})]"),
            None => format!("[Resource Link: {uri}]"),
        },
        ModelContextToolResultContent::ResourceText { resource, text } => {
            format!("[Resource: {}]\n{text}", resource.uri)
        }
        ModelContextToolResultContent::ResourceBlob { resource, blob } => format!(
            "[Resource: {} ({})]\n[Binary data: {} bytes]",
            resource.uri,
            resource
                .mime_type
                .as_deref()
                .unwrap_or("application/octet-stream"),
            blob.len()
        ),
    }
}
