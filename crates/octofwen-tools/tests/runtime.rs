#![expect(
    clippy::expect_used,
    reason = "test fixtures assert setup must succeed"
)]
#![expect(
    clippy::module_inception,
    reason = "test module mirrors runtime module path"
)]
use html2text as _;
use jsonschema as _;
use octofwen_workspace as _;
use reqwest as _;
use serde as _;
use serde_json as _;

mod runtime {
    mod lsp;
    mod mcp;
    mod runtime;
}
