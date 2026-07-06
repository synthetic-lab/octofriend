pub fn normalize_mention_path(path: &str) -> String {
    path.trim_start_matches("./").replace('\\', "/")
}
