use super::{ContentPart, ImageInfo, ToolCall};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenUsage {
    pub cached_input: u64,
    pub uncached_input: u64,
    pub total_input: u64,
    pub output: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub enum LlmIr {
    User {
        content: Vec<ContentPart>,
    },
    Assistant {
        content: String,
        reasoning_content: Option<String>,
        usage: TokenUsage,
    },
    Checkpoint {
        content: Vec<ContentPart>,
    },
    LoweredCheckpoint {
        content: Vec<ContentPart>,
    },
    Trajectory,
    ToolReject {
        tool_call: ToolCall,
    },
    FileRead {
        path: String,
        content: String,
        tool_call: ToolCall,
        image: Option<ImageInfo>,
    },
    FileMutate {
        path: String,
        content: String,
        tool_call: ToolCall,
    },
    ToolOutput {
        tool_call: ToolCall,
        content: Vec<ContentPart>,
    },
    ToolSkipOutput {
        tool_call: ToolCall,
        reason: String,
    },
}
