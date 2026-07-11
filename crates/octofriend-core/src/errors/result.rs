use std::{error::Error, fmt};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OctofriendError {
    pub message: String,
}

impl OctofriendError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for OctofriendError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for OctofriendError {}

pub type OctofriendResult<T> = Result<T, OctofriendError>;
