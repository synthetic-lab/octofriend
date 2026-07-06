#[derive(Clone, Debug, Eq, PartialEq)]
pub enum HoverContent {
    String(String),
    Markup { kind: String, value: String },
    MarkedString { language: String, value: String },
    Array(Vec<HoverContent>),
}

pub fn format_hover_contents(contents: &HoverContent) -> String {
    match contents {
        HoverContent::String(value) => value.clone(),
        HoverContent::Markup { value, .. } | HoverContent::MarkedString { value, .. } => {
            value.clone()
        }
        HoverContent::Array(values) => values
            .iter()
            .map(format_hover_contents)
            .collect::<Vec<_>>()
            .join("\n\n"),
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DiagnosticSeverity {
    Error,
    Warning,
    Information,
    Hint,
}

impl DiagnosticSeverity {
    fn name(self) -> &'static str {
        match self {
            Self::Error => "Error",
            Self::Warning => "Warning",
            Self::Information => "Information",
            Self::Hint => "Hint",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Diagnostic {
    pub severity: Option<DiagnosticSeverity>,
    pub range: Range,
    pub source: Option<String>,
    pub code: Option<String>,
    pub message: String,
}

pub fn format_diagnostics(diagnostics: &[Diagnostic]) -> String {
    if diagnostics.is_empty() {
        return "No diagnostics found.".into();
    }
    diagnostics
        .iter()
        .map(|diagnostic| {
            let severity = diagnostic
                .severity
                .unwrap_or(DiagnosticSeverity::Error)
                .name();
            let line = diagnostic.range.start.line + 1;
            let source = diagnostic.source.as_deref().unwrap_or("");
            let code = diagnostic.code.as_deref().unwrap_or("");
            format!(
                "[[ {severity} ]]: Line: {line} | Source: {source} | Error Code: {code} | \"{}\"",
                diagnostic.message
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Position {
    pub line: u32,
    pub character: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Range {
    pub start: Position,
    pub end: Position,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Location {
    pub uri: String,
    pub range: Range,
}

pub fn format_locations(locations: &[Location]) -> String {
    if locations.is_empty() {
        return "No locations found.".into();
    }
    locations
        .iter()
        .map(|location| {
            let file_path = location
                .uri
                .strip_prefix("file://")
                .unwrap_or(&location.uri);
            let line = location.range.start.line + 1;
            let column = location.range.start.character + 1;
            format!("{file_path}:{line}:{column}")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SymbolKind {
    File,
    Module,
    Namespace,
    Package,
    Class,
    Method,
    Property,
    Field,
    Constructor,
    Enum,
    Interface,
    Function,
    Variable,
    Constant,
    String,
    Number,
    Boolean,
    Array,
    Object,
    Key,
    Null,
    EnumMember,
    Struct,
    Event,
    Operator,
    TypeParameter,
}

impl SymbolKind {
    fn name(self) -> &'static str {
        match self {
            Self::File => "File",
            Self::Module => "Module",
            Self::Namespace => "Namespace",
            Self::Package => "Package",
            Self::Class => "Class",
            Self::Method => "Method",
            Self::Property => "Property",
            Self::Field => "Field",
            Self::Constructor => "Constructor",
            Self::Enum => "Enum",
            Self::Interface => "Interface",
            Self::Function => "Function",
            Self::Variable => "Variable",
            Self::Constant => "Constant",
            Self::String => "String",
            Self::Number => "Number",
            Self::Boolean => "Boolean",
            Self::Array => "Array",
            Self::Object => "Object",
            Self::Key => "Key",
            Self::Null => "Null",
            Self::EnumMember => "EnumMember",
            Self::Struct => "Struct",
            Self::Event => "Event",
            Self::Operator => "Operator",
            Self::TypeParameter => "TypeParameter",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DocumentSymbol {
    pub name: String,
    pub kind: SymbolKind,
    pub selection_range: Range,
    pub children: Vec<DocumentSymbol>,
}

pub fn format_document_symbols(symbols: &[DocumentSymbol]) -> String {
    if symbols.is_empty() {
        return "No symbols found.".into();
    }
    let mut lines = Vec::new();
    for symbol in symbols {
        append_document_symbol(&mut lines, symbol, 0);
    }
    lines.join("\n")
}

fn append_document_symbol(lines: &mut Vec<String>, symbol: &DocumentSymbol, depth: usize) {
    let indent = "  ".repeat(depth);
    let line = symbol.selection_range.start.line + 1;
    let column = symbol.selection_range.start.character + 1;
    lines.push(format!(
        "{indent}{} ({}) {line}:{column}",
        symbol.name,
        symbol.kind.name()
    ));
    for child in &symbol.children {
        append_document_symbol(lines, child, depth + 1);
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CallHierarchyItem {
    pub name: String,
    pub kind: SymbolKind,
    pub uri: String,
    pub selection_range: Range,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CallHierarchyDirection {
    Incoming,
    Outgoing,
}

impl CallHierarchyDirection {
    fn empty_message(self) -> &'static str {
        match self {
            Self::Incoming => "No incoming calls found.",
            Self::Outgoing => "No outgoing calls found.",
        }
    }
}

pub fn format_call_hierarchy(
    items: &[CallHierarchyItem],
    direction: CallHierarchyDirection,
) -> String {
    if items.is_empty() {
        return direction.empty_message().into();
    }
    items
        .iter()
        .map(|item| {
            let file_path = item.uri.strip_prefix("file://").unwrap_or(&item.uri);
            let line = item.selection_range.start.line + 1;
            let column = item.selection_range.start.character + 1;
            format!(
                "{} ({}) {file_path}:{line}:{column}",
                item.name,
                item.kind.name()
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn format_language_server_extensions_comment(
    extensions: impl IntoIterator<Item = impl Into<String>>,
) -> String {
    let mut extensions = extensions
        .into_iter()
        .map(Into::into)
        .collect::<Vec<String>>();
    extensions.sort();
    format!(
        "Only works on {} files; this tool will fail on other file types.",
        extensions.join(", ")
    )
}
