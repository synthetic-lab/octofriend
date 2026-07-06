use serde as _;
use serde_json as _;

mod providers {
    mod anthropic;
    mod anthropic_messages;
    mod openai;
    mod openai_messages;
    mod responses_input;
    mod stream;
    mod synthetic;
    mod tool_definitions;
}
