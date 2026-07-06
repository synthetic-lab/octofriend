use serde_json::Value;

#[derive(Clone, Debug, PartialEq)]
pub enum ToolContent {
    Text { content: String },
    Image { mime_type: String, data: String },
}

#[derive(Clone, Debug, PartialEq)]
pub enum ToolReturn {
    Output {
        content: Vec<ToolContent>,
        lines: Option<usize>,
    },
    InvokeSubagent {
        name: String,
    },
    CustomIr {
        data: Value,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub struct ToolRunResult {
    pub value: ToolReturn,
}

impl ToolRunResult {
    pub fn output_text(content: impl Into<String>) -> Self {
        Self {
            value: ToolReturn::Output {
                content: vec![ToolContent::Text {
                    content: content.into(),
                }],
                lines: None,
            },
        }
    }

    pub fn custom_ir(data: Value) -> Self {
        Self {
            value: ToolReturn::CustomIr { data },
        }
    }
}
