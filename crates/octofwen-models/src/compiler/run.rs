#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CompilerTokenType {
    Reasoning,
    Content,
    Tool,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct CompilerTokenBuffer {
    pub reasoning: String,
    pub content: String,
    pub tool: String,
    pub unexpected_tool_call: bool,
}

impl CompilerTokenBuffer {
    pub fn push(&mut self, token_type: CompilerTokenType, token: &str, tools_enabled: bool) {
        match token_type {
            CompilerTokenType::Reasoning => self.reasoning.push_str(token),
            CompilerTokenType::Content => self.content.push_str(token),
            CompilerTokenType::Tool => {
                if tools_enabled {
                    self.tool.push_str(token);
                } else {
                    self.unexpected_tool_call = true;
                }
            }
        }
    }
}
