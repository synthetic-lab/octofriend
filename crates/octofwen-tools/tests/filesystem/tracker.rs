use std::path::PathBuf;

use octofwen_tools::filesystem::{FileExistsError, FileTracker};

#[test]
fn file_tracker_records_read_timestamps_and_detects_newer_modification_times() {
    let mut tracker = FileTracker::new();
    let path = PathBuf::from("/workspace/src/main.rs");

    assert!(!tracker.is_outdated(&path, Ok(15)));

    tracker.record_file_read_timestamp(path.clone(), 10);

    assert!(!tracker.is_outdated(&path, Ok(10)));
    assert!(tracker.is_outdated(&path, Ok(11)));
    assert!(!tracker.is_outdated(&path, Err("missing".into())));
}

#[test]
fn file_tracker_can_create_only_when_file_metadata_is_missing() {
    let tracker = FileTracker::new();

    assert!(!tracker.can_create(Ok(10)));
    assert!(tracker.can_create(Err("missing".into())));
    assert_eq!(
        tracker.assert_can_create(Ok(10)),
        Err(FileExistsError::new("File already exists"))
    );
    assert_eq!(tracker.assert_can_create(Err("missing".into())), Ok(()));
}
