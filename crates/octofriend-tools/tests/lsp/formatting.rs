use octofriend_tools::lsp::{
    CallHierarchyDirection, CallHierarchyItem, Diagnostic, DiagnosticSeverity, DocumentSymbol,
    HoverContent, Location, Position, Range, SymbolKind, format_call_hierarchy, format_diagnostics,
    format_document_symbols, format_hover_contents, format_language_server_extensions_comment,
    format_locations,
};

#[test]
fn formats_hover_string_markup_and_markup_arrays() {
    assert_eq!(
        format_hover_contents(&HoverContent::String("plain docs".into())),
        "plain docs"
    );
    assert_eq!(
        format_hover_contents(&HoverContent::Markup {
            kind: "markdown".into(),
            value: "**docs**".into(),
        }),
        "**docs**"
    );
    assert_eq!(
        format_hover_contents(&HoverContent::Array(vec![
            HoverContent::String("signature".into()),
            HoverContent::MarkedString {
                language: "typescript".into(),
                value: "const value: string".into(),
            },
        ])),
        "signature\n\nconst value: string"
    );
}

#[test]
fn formats_diagnostics_with_one_indexed_lines() {
    let diagnostic = Diagnostic {
        severity: Some(DiagnosticSeverity::Warning),
        range: range(9, 2, 9, 8),
        source: Some("tsserver".into()),
        code: Some("2345".into()),
        message: "Type mismatch".into(),
    };

    assert_eq!(
        format_diagnostics(&[diagnostic]),
        "[[ Warning ]]: Line: 10 | Source: tsserver | Error Code: 2345 | \"Type mismatch\""
    );
    assert_eq!(format_diagnostics(&[]), "No diagnostics found.");
}

#[test]
fn formats_locations_with_one_indexed_line_and_column() {
    let location = Location {
        uri: "file:///repo/src/app.ts".into(),
        range: range(4, 7, 4, 12),
    };

    assert_eq!(format_locations(&[location]), "/repo/src/app.ts:5:8");
    assert_eq!(format_locations(&[]), "No locations found.");
}

#[test]
fn formats_nested_document_symbols_with_kind_names() {
    let symbols = vec![DocumentSymbol {
        name: "UserService".into(),
        kind: SymbolKind::Class,
        selection_range: range(9, 0, 9, 11),
        children: vec![DocumentSymbol {
            name: "validate".into(),
            kind: SymbolKind::Method,
            selection_range: range(14, 2, 14, 10),
            children: Vec::new(),
        }],
    }];

    assert_eq!(
        format_document_symbols(&symbols),
        "UserService (Class) 10:1\n  validate (Method) 15:3"
    );
    assert_eq!(format_document_symbols(&[]), "No symbols found.");
}

#[test]
fn formats_call_hierarchy_items_by_direction() {
    let item = CallHierarchyItem {
        name: "handleRequest".into(),
        kind: SymbolKind::Function,
        uri: "file:///repo/src/server.ts".into(),
        selection_range: range(14, 4, 14, 17),
    };

    assert_eq!(
        format_call_hierarchy(
            std::slice::from_ref(&item),
            CallHierarchyDirection::Incoming
        ),
        "handleRequest (Function) /repo/src/server.ts:15:5"
    );
    assert_eq!(
        format_call_hierarchy(&[item], CallHierarchyDirection::Outgoing),
        "handleRequest (Function) /repo/src/server.ts:15:5"
    );
    assert_eq!(
        format_call_hierarchy(&[], CallHierarchyDirection::Incoming),
        "No incoming calls found."
    );
}

#[test]
fn formats_sorted_language_server_extension_comments() {
    assert_eq!(
        format_language_server_extensions_comment([".tsx", ".ts"]),
        "Only works on .ts, .tsx files; this tool will fail on other file types."
    );
    assert_eq!(
        format_language_server_extensions_comment(Vec::<String>::new()),
        "Only works on  files; this tool will fail on other file types."
    );
}

fn range(start_line: u32, start_character: u32, end_line: u32, end_character: u32) -> Range {
    Range {
        start: Position {
            line: start_line,
            character: start_character,
        },
        end: Position {
            line: end_line,
            character: end_character,
        },
    }
}
