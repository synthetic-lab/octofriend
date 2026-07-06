pub mod line_range;
pub mod read;
pub mod search;
pub mod tracker;
pub mod write;

pub use line_range::{LineRangeResult, line_range, validate_line_range, with_line_numbers};
pub use search::{
    FILE_OUTDATED_ERROR_MESSAGE, SearchReplaceEdit, apply_search_replace_edit,
    validate_search_replace,
};
pub use tracker::{FileExistsError, FileTracker};
