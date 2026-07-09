use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{ChildStdin, ChildStdout};

use serde_json::{Map, Value, json};

type JsonObject = Map<String, Value>;
type CallHierarchyItemsResult = Result<Vec<CallHierarchyItem>, String>;

use crate::lsp::{
    CallHierarchyDirection, CallHierarchyItem, Diagnostic, DiagnosticSeverity, DocumentSymbol,
    HoverContent, Location, Position, Range, SymbolKind, format_call_hierarchy, format_diagnostics,
    format_document_symbols, format_hover_contents, format_locations,
};

use super::super::tool::output_text;

pub(super) struct LspRuntimeSession {
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
}

#[derive(Clone, Copy)]
pub(super) struct LspRunToolRequest<'a> {
    pub tool_name: &'a str,
    pub parsed: &'a Value,
    pub root_path: &'a str,
    pub resolved_file_path: &'a str,
    pub file_content: &'a str,
}

impl LspRuntimeSession {
    pub(super) fn new(stdin: ChildStdin, stdout: ChildStdout) -> Self {
        Self {
            stdin,
            stdout: BufReader::new(stdout),
            next_id: 1,
        }
    }

    pub(super) fn run_tool(&mut self, request: LspRunToolRequest<'_>) -> Result<Value, String> {
        let LspRunToolRequest {
            tool_name,
            parsed,
            root_path,
            resolved_file_path,
            file_content,
        } = request;
        let root_uri = file_uri(root_path);
        let file_uri = file_uri(resolved_file_path);
        let _ = self.request(
            "initialize",
            json!({
                "processId": std::process::id(),
                "capabilities": language_server_client_capabilities(),
                "rootUri": root_uri,
                "rootPath": root_path,
            }),
        )?;
        self.notify("initialized", json!({}))?;
        self.notify(
            "textDocument/didOpen",
            json!({
                "textDocument": {
                    "uri": file_uri,
                    "languageId": "plaintext",
                    "version": 1,
                    "text": file_content,
                }
            }),
        )?;

        match tool_name {
            "lsp-definition" => self.run_locations(
                "textDocument/definition",
                "Definition results",
                parsed,
                resolved_file_path,
            ),
            "lsp-implementation" => self.run_locations(
                "textDocument/implementation",
                "Implementation results",
                parsed,
                resolved_file_path,
            ),
            "lsp-references" => self.run_references(parsed, resolved_file_path),
            "lsp-hover" => self.run_hover(parsed, resolved_file_path),
            "lsp-incoming-calls" => self.run_call_hierarchy(
                parsed,
                resolved_file_path,
                CallHierarchyDirection::Incoming,
            ),
            "lsp-outgoing-calls" => self.run_call_hierarchy(
                parsed,
                resolved_file_path,
                CallHierarchyDirection::Outgoing,
            ),
            "lsp-diagnostics" => self.run_diagnostics(resolved_file_path),
            "lsp-document-symbol" => self.run_document_symbols(resolved_file_path),
            _ => Err(format!("unsupported tool run for {tool_name}")),
        }
    }

    fn run_locations(
        &mut self,
        method: &str,
        title: &str,
        parsed: &Value,
        file_path: &str,
    ) -> Result<Value, String> {
        let line = required_u64(parsed, "line")?;
        let character = required_u64(parsed, "character")?;
        let result = self.request(method, position_params(file_path, line, character))?;
        let locations = locations_from_value(&result)?;
        Ok(output_text(
            format!(
                "{title} for {file_path}:{line}:{character}:\n{}",
                format_locations(&locations)
            ),
            None,
        ))
    }

    fn run_references(&mut self, parsed: &Value, file_path: &str) -> Result<Value, String> {
        let line = required_u64(parsed, "line")?;
        let character = required_u64(parsed, "character")?;
        let mut params = position_params(file_path, line, character);
        if let Some(object) = params.as_object_mut() {
            object.insert("context".into(), json!({ "includeDeclaration": true }));
        }
        let result = self.request("textDocument/references", params)?;
        let locations = locations_from_value(&result)?;
        Ok(output_text(
            format!(
                "References for symbol at {file_path}:{line}:{character}:\n{}",
                format_locations(&locations)
            ),
            None,
        ))
    }

    fn run_hover(&mut self, parsed: &Value, file_path: &str) -> Result<Value, String> {
        let line = required_u64(parsed, "line")?;
        let character = required_u64(parsed, "character")?;
        let result = self.request(
            "textDocument/hover",
            position_params(file_path, line, character),
        )?;
        let hover = hover_from_value(&result)?
            .map(|content| format_hover_contents(&content))
            .unwrap_or_else(|| "No hover information available.".to_owned());
        Ok(output_text(
            format!("Hover info for {file_path}:{line}:{character}:\n{hover}"),
            None,
        ))
    }

    fn run_call_hierarchy(
        &mut self,
        parsed: &Value,
        file_path: &str,
        direction: CallHierarchyDirection,
    ) -> Result<Value, String> {
        let line = required_u64(parsed, "line")?;
        let character = required_u64(parsed, "character")?;
        let prepared = self.request(
            "textDocument/prepareCallHierarchy",
            position_params(file_path, line, character),
        )?;
        let items = call_hierarchy_items_from_value(&prepared)?;
        let calls = if let Some(item) = items.first() {
            let method = match direction {
                CallHierarchyDirection::Incoming => "callHierarchy/incomingCalls",
                CallHierarchyDirection::Outgoing => "callHierarchy/outgoingCalls",
            };
            let result = self.request(method, json!({ "item": call_hierarchy_item_json(item) }))?;
            call_hierarchy_result_items_from_value(&result, direction)?
        } else {
            Vec::new()
        };
        let label = match direction {
            CallHierarchyDirection::Incoming => "Incoming calls to symbol at",
            CallHierarchyDirection::Outgoing => "Outgoing calls from symbol at",
        };
        Ok(output_text(
            format!(
                "{label} {file_path}:{line}:{character}:\n{}",
                format_call_hierarchy(&calls, direction)
            ),
            None,
        ))
    }

    fn run_diagnostics(&mut self, file_path: &str) -> Result<Value, String> {
        let uri = file_uri(file_path);
        let diagnostics = self.wait_for_diagnostics(&uri)?;
        Ok(output_text(
            format!(
                "Diagnostics for {file_path}:\n{}",
                format_diagnostics(&diagnostics)
            ),
            None,
        ))
    }

    fn run_document_symbols(&mut self, file_path: &str) -> Result<Value, String> {
        let result = self.request(
            "textDocument/documentSymbol",
            json!({ "textDocument": { "uri": file_uri(file_path) } }),
        )?;
        let symbols = document_symbols_from_value(&result)?;
        Ok(output_text(
            format!(
                "Symbols in {file_path}:\n{}",
                format_document_symbols(&symbols)
            ),
            None,
        ))
    }

    fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        self.write_message(
            &json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }),
        )?;
        self.wait_for_response(id)
    }

    fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        self.write_message(&json!({ "jsonrpc": "2.0", "method": method, "params": params }))
    }

    fn write_message(&mut self, message: &Value) -> Result<(), String> {
        let body = serde_json::to_vec(message)
            .map_err(|error| format!("LSP message encoding failed: {error}"))?;
        write!(self.stdin, "Content-Length: {}\r\n\r\n", body.len())
            .and_then(|()| self.stdin.write_all(&body))
            .and_then(|()| self.stdin.flush())
            .map_err(|error| format!("LSP server write failed: {error}"))
    }

    fn wait_for_response(&mut self, id: u64) -> Result<Value, String> {
        loop {
            let Some(message) = read_lsp_message(&mut self.stdout)? else {
                return Err(format!("LSP server closed before response {id}"));
            };
            if message.get("id").and_then(Value::as_u64) != Some(id) {
                continue;
            }
            if let Some(error) = message.get("error") {
                return Err(format!("LSP error: {error}"));
            }
            return Ok(message.get("result").cloned().unwrap_or(Value::Null));
        }
    }

    fn wait_for_diagnostics(&mut self, uri: &str) -> Result<Vec<Diagnostic>, String> {
        loop {
            let Some(message) = read_lsp_message(&mut self.stdout)? else {
                return Ok(Vec::new());
            };
            if message.get("method").and_then(Value::as_str)
                != Some("textDocument/publishDiagnostics")
            {
                continue;
            }
            let params = object_field(&message, "params")?;
            if params.get("uri").and_then(Value::as_str) != Some(uri) {
                continue;
            }
            let diagnostics = params
                .get("diagnostics")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .map(diagnostic_from_value)
                        .collect::<Result<Vec<_>, _>>()
                })
                .transpose()?
                .unwrap_or_default();
            return Ok(diagnostics);
        }
    }
}

fn read_lsp_message(reader: &mut impl BufRead) -> Result<Option<Value>, String> {
    let mut content_length = None;
    loop {
        let mut line = String::new();
        let bytes = reader
            .read_line(&mut line)
            .map_err(|error| format!("LSP server read failed: {error}"))?;
        if bytes == 0 {
            return Ok(None);
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some(value) = trimmed.strip_prefix("Content-Length:") {
            content_length = Some(
                value
                    .trim()
                    .parse::<usize>()
                    .map_err(|error| format!("Invalid LSP Content-Length: {error}"))?,
            );
        }
    }
    let length = content_length.ok_or_else(|| "LSP message missing Content-Length".to_owned())?;
    let mut body = vec![0; length];
    reader
        .read_exact(&mut body)
        .map_err(|error| format!("LSP message body read failed: {error}"))?;
    serde_json::from_slice(&body)
        .map(Some)
        .map_err(|error| format!("LSP message JSON parse failed: {error}"))
}

fn position_params(file_path: &str, line: u64, character: u64) -> Value {
    json!({
        "textDocument": { "uri": file_uri(file_path) },
        "position": { "line": line.saturating_sub(1), "character": character.saturating_sub(1) }
    })
}

fn file_uri(file_path: &str) -> String {
    format!("file://{}", Path::new(file_path).display())
}

fn language_server_client_capabilities() -> Value {
    json!({
        "textDocument": {
            "publishDiagnostics": { "relatedInformation": true },
            "hover": { "contentFormat": ["markdown", "plaintext"], "dynamicRegistration": false },
            "definition": { "dynamicRegistration": false, "linkSupport": false },
            "references": { "dynamicRegistration": false },
            "implementation": { "dynamicRegistration": false },
            "documentSymbol": { "dynamicRegistration": false, "hierarchicalDocumentSymbolSupport": true },
            "callHierarchy": { "dynamicRegistration": false }
        }
    })
}

fn locations_from_value(value: &Value) -> Result<Vec<Location>, String> {
    if value.is_null() {
        return Ok(Vec::new());
    }
    value
        .as_array()
        .ok_or_else(|| "LSP location result must be an array".to_owned())?
        .iter()
        .map(location_from_value)
        .collect()
}

fn location_from_value(value: &Value) -> Result<Location, String> {
    Ok(Location {
        uri: required_value_string(value, "uri")?,
        range: range_from_object(object_field(value, "range")?)?,
    })
}

fn hover_from_value(value: &Value) -> Result<Option<HoverContent>, String> {
    if value.is_null() {
        return Ok(None);
    }
    let object = value
        .as_object()
        .ok_or_else(|| "LSP hover result must be an object".to_owned())?;
    let Some(contents) = object.get("contents") else {
        return Ok(None);
    };
    hover_content_from_value(contents).map(Some)
}

fn hover_content_from_value(value: &Value) -> Result<HoverContent, String> {
    if let Some(text) = value.as_str() {
        return Ok(HoverContent::String(text.to_owned()));
    }
    if let Some(array) = value.as_array() {
        return array
            .iter()
            .map(hover_content_from_value)
            .collect::<Result<Vec<_>, _>>()
            .map(HoverContent::Array);
    }
    let object = value
        .as_object()
        .ok_or_else(|| "LSP hover content must be a string, array, or object".to_owned())?;
    let value = required_object_string(object, "value")?;
    if let Some(language) = object.get("language").and_then(Value::as_str) {
        return Ok(HoverContent::MarkedString {
            language: language.to_owned(),
            value,
        });
    }
    Ok(HoverContent::Markup {
        kind: object
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("plaintext")
            .to_owned(),
        value,
    })
}

fn document_symbols_from_value(value: &Value) -> Result<Vec<DocumentSymbol>, String> {
    value
        .as_array()
        .ok_or_else(|| "LSP document symbol result must be an array".to_owned())?
        .iter()
        .map(document_symbol_from_value)
        .collect()
}

fn document_symbol_from_value(value: &Value) -> Result<DocumentSymbol, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "LSP document symbol must be an object".to_owned())?;
    let children = object
        .get("children")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(document_symbol_from_value)
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()?
        .unwrap_or_default();
    Ok(DocumentSymbol {
        name: required_object_string(object, "name")?,
        kind: symbol_kind_from_value(object.get("kind"))?,
        selection_range: range_from_object(object_field(value, "selectionRange")?)?,
        children,
    })
}

fn diagnostic_from_value(value: &Value) -> Result<Diagnostic, String> {
    Ok(Diagnostic {
        severity: value
            .get("severity")
            .map(diagnostic_severity_from_value)
            .transpose()?,
        range: range_from_object(object_field(value, "range")?)?,
        source: value
            .get("source")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        code: value.get("code").map(lsp_code_to_string).transpose()?,
        message: required_value_string(value, "message")?,
    })
}

fn call_hierarchy_items_from_value(value: &Value) -> CallHierarchyItemsResult {
    value
        .as_array()
        .ok_or_else(|| "LSP call hierarchy result must be an array".to_owned())?
        .iter()
        .map(call_hierarchy_item_from_value)
        .collect()
}

fn call_hierarchy_result_items_from_value(
    value: &Value,
    direction: CallHierarchyDirection,
) -> CallHierarchyItemsResult {
    value
        .as_array()
        .ok_or_else(|| "LSP call hierarchy call result must be an array".to_owned())?
        .iter()
        .map(|entry| {
            let key = match direction {
                CallHierarchyDirection::Incoming => "from",
                CallHierarchyDirection::Outgoing => "to",
            };
            call_hierarchy_item_from_value(
                entry
                    .get(key)
                    .ok_or_else(|| format!("LSP call hierarchy result missing {key}"))?,
            )
        })
        .collect()
}

fn call_hierarchy_item_from_value(value: &Value) -> Result<CallHierarchyItem, String> {
    Ok(CallHierarchyItem {
        name: required_value_string(value, "name")?,
        kind: symbol_kind_from_value(value.get("kind"))?,
        uri: required_value_string(value, "uri")?,
        selection_range: range_from_object(object_field(value, "selectionRange")?)?,
    })
}

fn call_hierarchy_item_json(item: &CallHierarchyItem) -> Value {
    json!({
        "name": item.name,
        "kind": symbol_kind_number(item.kind),
        "uri": item.uri,
        "selectionRange": range_json(item.selection_range),
        "range": range_json(item.selection_range),
    })
}

fn range_from_object(object: &JsonObject) -> Result<Range, String> {
    Ok(Range {
        start: position_from_object(object_field_map(object, "start")?)?,
        end: position_from_object(object_field_map(object, "end")?)?,
    })
}

fn position_from_object(object: &JsonObject) -> Result<Position, String> {
    Ok(Position {
        line: required_object_u32(object, "line")?,
        character: required_object_u32(object, "character")?,
    })
}

fn required_object_u32(object: &JsonObject, key: &str) -> Result<u32, String> {
    let value = required_object_u64(object, key)?;
    u32::try_from(value).map_err(|_| format!("LSP position {key} is too large: {value}"))
}

fn range_json(range: Range) -> Value {
    json!({
        "start": { "line": range.start.line, "character": range.start.character },
        "end": { "line": range.end.line, "character": range.end.character }
    })
}

fn object_field<'a>(value: &'a Value, key: &str) -> Result<&'a Map<String, Value>, String> {
    value
        .get(key)
        .and_then(Value::as_object)
        .ok_or_else(|| format!("LSP object missing {key}"))
}

fn object_field_map<'a>(
    object: &'a Map<String, Value>,
    key: &str,
) -> Result<&'a Map<String, Value>, String> {
    object
        .get(key)
        .and_then(Value::as_object)
        .ok_or_else(|| format!("LSP object missing {key}"))
}

fn required_value_string(value: &Value, key: &str) -> Result<String, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("LSP object missing string {key}"))
}

fn required_object_string(object: &JsonObject, key: &str) -> Result<String, String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("LSP object missing string {key}"))
}

fn required_object_u64(object: &JsonObject, key: &str) -> Result<u64, String> {
    object
        .get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| format!("LSP object missing number {key}"))
}

fn required_u64(value: &Value, key: &str) -> Result<u64, String> {
    value
        .get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| format!("lsp tool argument {key} must be a number"))
}

fn diagnostic_severity_from_value(value: &Value) -> Result<DiagnosticSeverity, String> {
    match value.as_u64() {
        Some(1) => Ok(DiagnosticSeverity::Error),
        Some(2) => Ok(DiagnosticSeverity::Warning),
        Some(3) => Ok(DiagnosticSeverity::Information),
        Some(4) => Ok(DiagnosticSeverity::Hint),
        _ => Err("LSP diagnostic severity must be 1, 2, 3, or 4".to_owned()),
    }
}

fn lsp_code_to_string(value: &Value) -> Result<String, String> {
    if let Some(text) = value.as_str() {
        return Ok(text.to_owned());
    }
    if let Some(number) = value.as_i64() {
        return Ok(number.to_string());
    }
    Err("LSP diagnostic code must be a string or number".to_owned())
}

fn symbol_kind_from_value(value: Option<&Value>) -> Result<SymbolKind, String> {
    value
        .and_then(Value::as_u64)
        .and_then(SymbolKind::from_lsp_number)
        .ok_or_else(|| "LSP symbol kind must be between 1 and 26".to_owned())
}

fn symbol_kind_number(kind: SymbolKind) -> u8 {
    kind.lsp_number()
}
