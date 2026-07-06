pub fn open_tag(tag: &str, attrs: &[(&str, &str)]) -> String {
    if attrs.is_empty() {
        return format!("<{tag}>");
    }

    let attr_string = attrs
        .iter()
        .map(|(key, value)| format!("{key}=\"{value}\""))
        .collect::<Vec<_>>()
        .join(" ");

    format!("<{tag} {attr_string}>")
}

pub fn close_tag(tag: &str) -> String {
    format!("</{tag}>")
}

pub fn tagged(tag: &str, attrs: &[(&str, &str)], content: &[&str]) -> String {
    format!(
        "{}{}{}",
        open_tag(tag, attrs),
        content.join(""),
        close_tag(tag)
    )
}

pub fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
