use octofwen_tools::web::{SearchRequest, SearchResult, render_search_results};

#[test]
fn builds_search_post_requests_with_bearer_auth_and_json_body() {
    let request = SearchRequest::new("https://search.example/query", "search-key", "octofwen");

    assert_eq!(request.url, "https://search.example/query");
    assert_eq!(request.method, "POST");
    assert_eq!(request.authorization_header, "Bearer search-key");
    assert_eq!(request.body, r#"{"query":"octofwen"}"#);
}

#[test]
fn renders_search_results_as_newline_delimited_json() {
    let rendered = render_search_results(&[
        SearchResult {
            url: "https://example.com/a".into(),
            title: "A".into(),
            text: "Alpha".into(),
            published: None,
        },
        SearchResult {
            url: "https://example.com/b".into(),
            title: "B".into(),
            text: "Beta".into(),
            published: Some("2026-07-04".into()),
        },
    ]);

    assert_eq!(
        rendered,
        "{\"url\":\"https://example.com/a\",\"title\":\"A\",\"text\":\"Alpha\",\"published\":null}\n{\"url\":\"https://example.com/b\",\"title\":\"B\",\"text\":\"Beta\",\"published\":\"2026-07-04\"}"
    );
}
