use comrak::{Options, markdown_to_html};
use html2text::{config, render::TextDecorator};

pub(super) fn render_markdown_template(template: &str, values: &[(&str, &str)]) -> String {
    let (protected_template, placeholders) = protect_template_literals(template);
    let markdown = render_markdown_text(&protected_template);
    let template = restore_template_literals(&markdown, &placeholders);
    render_template(&template, values).trim_end().to_owned()
}

fn markdown_options<'a>() -> Options<'a> {
    let mut options = Options::default();
    options.extension.strikethrough = true;
    options.extension.table = true;
    options.extension.autolink = true;
    options.extension.tasklist = true;
    options.render.hardbreaks = true;
    options
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
struct PromptTextDecorator {
    link_targets: Vec<String>,
}

impl TextDecorator for PromptTextDecorator {
    type Annotation = ();

    fn decorate_link_start(&mut self, url: &str) -> (String, Self::Annotation) {
        self.link_targets.push(url.to_owned());
        (String::new(), ())
    }

    fn decorate_link_end(&mut self) -> String {
        self.link_targets
            .pop()
            .filter(|url| !url.is_empty())
            .map(|url| format!(" [{url}]"))
            .unwrap_or_default()
    }

    fn decorate_em_start(&self) -> (String, Self::Annotation) {
        (String::new(), ())
    }

    fn decorate_em_end(&self) -> String {
        String::new()
    }

    fn decorate_strong_start(&self) -> (String, Self::Annotation) {
        (String::new(), ())
    }

    fn decorate_strong_end(&self) -> String {
        String::new()
    }

    fn decorate_strikeout_start(&self) -> (String, Self::Annotation) {
        (String::new(), ())
    }

    fn decorate_strikeout_end(&self) -> String {
        String::new()
    }

    fn decorate_code_start(&self) -> (String, Self::Annotation) {
        (String::new(), ())
    }

    fn decorate_code_end(&self) -> String {
        String::new()
    }

    fn decorate_preformat_first(&self) -> Self::Annotation {}

    fn decorate_preformat_cont(&self) -> Self::Annotation {}

    fn decorate_image(&mut self, src: &str, title: &str) -> (String, Self::Annotation) {
        let label = if title.is_empty() { src } else { title };
        (format!("[{label}]"), ())
    }

    fn header_prefix(&self, level: usize) -> String {
        "#".repeat(level) + " "
    }

    fn quote_prefix(&self) -> String {
        "> ".to_owned()
    }

    fn unordered_item_prefix(&self) -> String {
        "* ".to_owned()
    }

    fn ordered_item_prefix(&self, index: i64) -> String {
        format!("{index}. ")
    }

    fn make_subblock_decorator(&self) -> Self {
        Self::default()
    }
}

fn render_markdown_text(markdown: &str) -> String {
    let html = markdown_to_html(markdown, &markdown_options());
    config::with_decorator(PromptTextDecorator::default())
        .no_table_borders()
        .string_from_read(html.as_bytes(), 4_096)
        .expect("markdown template HTML should render to text")
        .trim_end()
        .to_owned()
}

fn protect_template_literals(template: &str) -> (String, Vec<(String, String)>) {
    let mut protected = String::with_capacity(template.len());
    let mut placeholders = Vec::new();
    let mut rest = template;

    while let Some((start, end)) = next_template_literal(rest) {
        protected.push_str(&rest[..start]);

        let original = &rest[start..end];
        let token = format!("\u{e000}{}\u{e001}", placeholders.len());
        protected.push_str(&token);
        placeholders.push((token, original.to_owned()));
        rest = &rest[end..];
    }

    protected.push_str(rest);
    (protected, placeholders)
}

fn next_template_literal(rest: &str) -> Option<(usize, usize)> {
    let placeholder = rest.find("{{").and_then(|start| {
        rest[start + 2..]
            .find("}}")
            .map(|close| (start, start + close + 4))
    });
    let prompt_tag = rest.find('<').and_then(|start| {
        let after_open = rest[start + 1..].chars().next()?;
        if after_open != '/' && !after_open.is_ascii_alphabetic() {
            return None;
        }
        rest[start + 1..]
            .find('>')
            .map(|close| (start, start + close + 2))
    });

    [placeholder, prompt_tag]
        .into_iter()
        .flatten()
        .min_by_key(|(start, _)| *start)
}

fn restore_template_literals(template: &str, placeholders: &[(String, String)]) -> String {
    placeholders
        .iter()
        .fold(template.to_owned(), |template, (token, placeholder)| {
            template.replace(token, placeholder)
        })
}

fn render_template(template: &str, values: &[(&str, &str)]) -> String {
    let mut rendered = String::with_capacity(template.len());
    let mut rest = template;

    while let Some(open_index) = rest.find("{{") {
        rendered.push_str(&rest[..open_index]);
        let placeholder = &rest[open_index + 2..];
        let Some(close_index) = placeholder.find("}}") else {
            rendered.push_str(&rest[open_index..]);
            return rendered;
        };

        let key = &placeholder[..close_index];
        if let Some((_, value)) = values.iter().find(|(name, _)| *name == key) {
            rendered.push_str(value);
        } else {
            rendered.push_str(&rest[open_index..open_index + close_index + 4]);
        }
        rest = &placeholder[close_index + 2..];
    }

    rendered.push_str(rest);
    rendered
}
#[cfg(test)]
mod tests {
    use super::render_markdown_template;

    #[test]
    fn render_markdown_template_renders_common_markdown_without_prompt_fence_artifacts() {
        let prompt = render_markdown_template(
            r#"# Heading

A paragraph with **bold**, _emphasis_, and [a link](https://example.test).

- First
- Second

| Name | Value |
| --- | --- |
| alpha | beta |

```typescript
type Response = {
  success: true,
};
```

Use {{value}}.
"#,
            &[("value", "runtime value")],
        );

        assert!(prompt.starts_with("# Heading\n\n"));
        assert!(
            prompt.contains("A paragraph with bold, emphasis, and a link [https://example.test].")
        );
        assert!(prompt.contains("* First"));
        assert!(prompt.contains("* Second"));
        assert!(prompt.contains("Name"));
        assert!(prompt.contains("Value"));
        assert!(prompt.contains("alpha"));
        assert!(prompt.contains("beta"));
        assert!(prompt.contains("type Response = {\n  success: true,\n};\n\nUse runtime value."));
        assert!(!prompt.contains("```"));
        assert!(!prompt.contains("typescript"));
    }

    #[test]
    fn render_markdown_template_preserves_prompt_xml_tags() {
        let prompt = render_markdown_template(
            r#"<summary>

## Primary Request

{{request}}

</summary>
"#,
            &[("request", "Keep XML tags literal")],
        );

        assert_eq!(
            prompt,
            r#"<summary>

## Primary Request

Keep XML tags literal

</summary>"#
        );
    }
}
