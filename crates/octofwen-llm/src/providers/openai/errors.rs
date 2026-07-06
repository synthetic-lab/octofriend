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
    let special_status = error.status == Some(402) || error.status == Some(429);
    if !special_status || error.headers.is_empty() {
        return OpenAiCompilerError::RequestError {
            request_error: error.fallback,
            curl,
            headers: error.headers,
        };
    }

    let request_error = error
        .error
        .unwrap_or_else(|| "OpenAI request failed".into());
    if error.status == Some(402) {
        OpenAiCompilerError::PaymentError {
            request_error,
            curl,
            headers: error.headers,
        }
    } else {
        OpenAiCompilerError::RateLimitError {
            request_error,
            curl,
            headers: error.headers,
        }
    }
}
