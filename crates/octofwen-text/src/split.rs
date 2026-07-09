pub(crate) fn split_into_words(text: &str) -> Vec<String> {
    let chars = text.chars().collect::<Vec<_>>();
    let mut words = Vec::new();
    let mut current = String::new();

    for index in 0..chars.len() {
        let character = chars[index];
        current.push(character);

        if character.is_whitespace() && index + 1 < chars.len() && !chars[index + 1].is_whitespace()
        {
            words.push(std::mem::take(&mut current));
        }
    }

    if !current.is_empty() {
        words.push(current);
    }

    words
}

pub(crate) fn split_lines(text: &str) -> Vec<&str> {
    let mut lines = Vec::new();
    let mut start = 0;
    let bytes = text.as_bytes();
    let mut index = 0;

    while index < bytes.len() {
        match bytes[index] {
            b'\r' => {
                lines.push(&text[start..index]);
                index += usize::from(index + 1 < bytes.len() && bytes[index + 1] == b'\n') + 1;
                start = index;
            }
            b'\n' => {
                lines.push(&text[start..index]);
                index += 1;
                start = index;
            }
            _ => index += 1,
        }
    }

    lines.push(&text[start..]);
    lines
}
