use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SearchRequest {
    pub url: String,
    pub method: String,
    pub authorization_header: String,
    pub body: String,
}

impl SearchRequest {
    pub fn new(url: impl Into<String>, key: impl AsRef<str>, query: impl AsRef<str>) -> Self {
        let query = query.as_ref();
        Self {
            url: url.into(),
            method: "POST".into(),
            authorization_header: format!("Bearer {}", key.as_ref()),
            body: json!({ "query": query }).to_string(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct SearchResult {
    pub url: String,
    pub title: String,
    pub text: String,
    pub published: Option<String>,
}

pub fn render_search_results(results: &[SearchResult]) -> String {
    results
        .iter()
        .map(|entry| {
            serde_json::to_string(entry).unwrap_or_else(|error| {
                json!({ "error": format!("failed to render search result: {error}") }).to_string()
            })
        })
        .collect::<Vec<_>>()
        .join("\n")
}
