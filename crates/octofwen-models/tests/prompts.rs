use comrak as _;
use html2text as _;
use schemars as _;
use serde as _;
use serde_json as _;

mod prompts {
    mod autofix;
    mod compaction;
    mod fragments;
    mod instructions;
    mod model_context;
    mod system;
    mod xml;
}
