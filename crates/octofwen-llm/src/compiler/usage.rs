use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct CompilerInputUsage {
    pub cached: u64,
    pub uncached: u64,
    pub total: u64,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct CompilerUsage {
    pub input: CompilerInputUsage,
    pub output: u64,
}

impl CompilerUsage {
    pub fn new(input_total: u64, output: u64, cached: u64) -> Self {
        Self {
            input: CompilerInputUsage {
                cached,
                uncached: input_total.saturating_sub(cached),
                total: input_total,
            },
            output,
        }
    }

    pub const fn has_tokens(self) -> bool {
        self.input.total != 0 || self.output != 0
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ModelTokenUsage {
    pub input: u64,
    pub output: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TokenType {
    Input,
    Output,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct TokenUsageTracker {
    total_tokens: BTreeMap<String, ModelTokenUsage>,
}

impl TokenUsageTracker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn track_tokens(&mut self, model: impl Into<String>, token_type: TokenType, count: u64) {
        let usage = self.total_tokens.entry(model.into()).or_default();
        match token_type {
            TokenType::Input => usage.input += count,
            TokenType::Output => usage.output += count,
        }
    }

    pub fn token_counts(&self) -> &BTreeMap<String, ModelTokenUsage> {
        &self.total_tokens
    }
}
