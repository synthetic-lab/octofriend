#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OpenAiCompilerError {
    RequestError {
        request_error: String,
        curl: String,
        headers: Vec<(String, String)>,
    },
    PaymentError {
        request_error: String,
        curl: String,
        headers: Vec<(String, String)>,
    },
    RateLimitError {
        request_error: String,
        curl: String,
        headers: Vec<(String, String)>,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OpenAiStatusError {
    pub status: Option<u16>,
    pub headers: Vec<(String, String)>,
    pub error: Option<String>,
    pub fallback: String,
}

pub fn openai_request_error(
    curl: impl Into<String>,
    error: OpenAiStatusError,
) -> OpenAiCompilerError {
    let curl = curl.into();
    if error.status == Some(402) {
        return OpenAiCompilerError::PaymentError {
            request_error: error
                .error
                .unwrap_or_else(|| "OpenAI request failed".into()),
            curl,
            headers: error.headers,
        };
    }

    if error.status == Some(429) && !error.headers.is_empty() {
        return OpenAiCompilerError::RateLimitError {
            request_error: error
                .error
                .unwrap_or_else(|| "OpenAI request failed".into()),
            curl,
            headers: error.headers,
        };
    }

    OpenAiCompilerError::RequestError {
        request_error: error.fallback,
        curl,
        headers: error.headers,
    }
}
