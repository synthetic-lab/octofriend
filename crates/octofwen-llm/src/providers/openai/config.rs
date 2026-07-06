#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OpenAiClientConfig {
    pub base_url: String,
    pub api_key: String,
    pub default_headers: Vec<(String, String)>,
}

pub fn openai_client_config(
    base_url: impl Into<String>,
    api_key: impl Into<String>,
    app_version: impl AsRef<str>,
) -> OpenAiClientConfig {
    OpenAiClientConfig {
        base_url: base_url.into(),
        api_key: api_key.into(),
        default_headers: vec![(
            "User-Agent".into(),
            format!("octofriend/{}", app_version.as_ref()),
        )],
    }
}
