use std::{error::Error, fmt};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OctofwenError {
    pub message: String,
}

impl OctofwenError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for OctofwenError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for OctofwenError {}

pub type OctofwenResult<T> = Result<T, OctofwenError>;
