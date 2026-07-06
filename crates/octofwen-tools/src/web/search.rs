use serde::{Deserialize, Serialize};

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
            body: format!(r#"{{"query":"{}"}}"#, escape_json_string(query)),
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
                format!(r#"{{"error":"failed to render search result: {error}"}}"#)
            })
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn escape_json_string(value: &str) -> String {
    value
        .chars()
        .flat_map(|character| match character {
            '"' => ['\\', '"'].into_iter().collect::<Vec<_>>(),
            '\\' => ['\\', '\\'].into_iter().collect::<Vec<_>>(),
            '\n' => ['\\', 'n'].into_iter().collect::<Vec<_>>(),
            '\r' => ['\\', 'r'].into_iter().collect::<Vec<_>>(),
            '\t' => ['\\', 't'].into_iter().collect::<Vec<_>>(),
            other => [other].into_iter().collect::<Vec<_>>(),
        })
        .collect()
}
