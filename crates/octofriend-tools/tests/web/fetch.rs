use octofriend_tools::web::{FetchResponse, render_fetch_response, strip_html_to_text};

#[test]
fn strips_basic_html_resources_to_terminal_text_by_default() {
    assert_eq!(
        strip_html_to_text("<html><body><h1>Hello</h1><p>World</p></body></html>"),
        "HELLO\n\nWorld"
    );
}

#[test]
fn keeps_markup_when_fetch_response_requests_markup() {
    let response = FetchResponse {
        status: 200,
        body: "<h1>Hello</h1>".into(),
    };

    assert_eq!(
        render_fetch_response(&response, true, 200),
        Ok("<h1>Hello</h1>".into())
    );
}

#[test]
fn formats_fetch_authorization_and_generic_request_errors() {
    let forbidden = FetchResponse {
        status: 403,
        body: "<p>Forbidden</p>".into(),
    };
    let missing = FetchResponse {
        status: 404,
        body: "<p>Missing</p>".into(),
    };

    assert_eq!(
        render_fetch_response(&forbidden, false, 200),
        Err("Authorization failed: status code 403\nForbidden\nThis appears to have failed authorization, ask the user for help: they may be able to read the URL and copy/paste for you.".into())
    );
    assert_eq!(
        render_fetch_response(&missing, false, 200),
        Err("Request failed: Missing".into())
    );
}

#[test]
fn rejects_fetch_content_larger_than_the_model_context() {
    let response = FetchResponse {
        status: 200,
        body: "abcdef".into(),
    };

    assert_eq!(
        render_fetch_response(&response, true, 5),
        Err("Web content too large: 6 bytes (max: 5 bytes)".into())
    );
}
