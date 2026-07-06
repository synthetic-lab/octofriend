#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FetchResponse {
    pub status: u16,
    pub body: String,
}

pub fn render_fetch_response(
    response: &FetchResponse,
    include_markup: bool,
    context_limit: usize,
) -> Result<String, String> {
    let text = if include_markup {
        response.body.clone()
    } else {
        strip_html_to_text(&response.body)
    };

    if response.status == 403 {
        return Err(format!(
            "Authorization failed: status code 403\n{text}\nThis appears to have failed authorization, ask the user for help: they may be able to read the URL and copy/paste for you."
        ));
    }
    if !(200..300).contains(&response.status) {
        return Err(format!("Request failed: {text}"));
    }
    if text.len() > context_limit {
        return Err(format!(
            "Web content too large: {} bytes (max: {context_limit} bytes)",
            text.len()
        ));
    }
    Ok(text)
}

pub fn strip_html_to_text(html: &str) -> String {
    let mut output = String::new();
    let mut tag = String::new();
    let mut text = String::new();
    let mut in_tag = false;
    let mut uppercase_text = false;

    for character in html.chars() {
        if in_tag {
            if character == '>' {
                let normalized = tag.trim().trim_start_matches('/').to_ascii_lowercase();
                let closing = tag.trim_start().starts_with('/');
                if !closing && normalized == "h1" {
                    uppercase_text = true;
                }
                if closing && normalized == "h1" {
                    push_text(&mut output, &text, true);
                    text.clear();
                    uppercase_text = false;
                } else if closing && normalized == "p" {
                    push_text(&mut output, &text, false);
                    text.clear();
                } else if !closing && normalized == "p" && !output.is_empty() {
                    ensure_blank_line(&mut output);
                }
                tag.clear();
                in_tag = false;
            } else {
                tag.push(character);
            }
            continue;
        }

        if character == '<' {
            in_tag = true;
            tag.clear();
        } else {
            text.push(character);
        }
    }

    push_text(&mut output, &text, uppercase_text);
    output.trim_matches('\n').to_owned()
}

fn push_text(output: &mut String, text: &str, uppercase: bool) {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return;
    }
    if !output.is_empty() && !output.ends_with("\n\n") {
        ensure_blank_line(output);
    }
    if uppercase {
        output.push_str(&trimmed.to_uppercase());
    } else {
        output.push_str(trimmed);
    }
}

fn ensure_blank_line(output: &mut String) {
    while output.ends_with('\n') {
        output.pop();
    }
    output.push_str("\n\n");
}
