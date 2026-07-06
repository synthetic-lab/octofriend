pub mod fetch;
pub mod search;

pub use fetch::{FetchResponse, render_fetch_response, strip_html_to_text};
pub use search::{SearchRequest, SearchResult, render_search_results};
