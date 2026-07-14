import React from "react";
import { Div, Span } from "paintcannon-react";
type LspToolParsedSchema = {
  name: `lsp-${string}`;
  arguments: any;
};
type LspToolName = LspToolParsedSchema["name"];
const LSP_TOOL_ACTION_NAMES: Record<LspToolName, string> = {
  "lsp-definition": "definition",
  "lsp-references": "references",
  "lsp-hover": "hover",
  "lsp-diagnostics": "diagnostics",
  "lsp-document-symbol": "document symbol",
  "lsp-implementation": "implementation",
  "lsp-incoming-calls": "incoming calls",
  "lsp-outgoing-calls": "outgoing calls",
};
function getLspActionName(toolName: LspToolName): string {
  return LSP_TOOL_ACTION_NAMES[toolName] ?? "query";
}
export function LspToolRenderer({ item }: { item: LspToolParsedSchema }) {
  const lspAction = getLspActionName(item.name);
  switch (item.name) {
    case "lsp-diagnostics":
    case "lsp-document-symbol":
      return (
        <Div
          style={{
            display: "flex",
            whiteSpace: "pre-wrap",
          }}
        >
          <Span>
            Octo wants to run LSP {lspAction} on {item.arguments.filePath}
          </Span>
        </Div>
      );
    case "lsp-definition":
    case "lsp-references":
    case "lsp-hover":
    case "lsp-implementation":
    case "lsp-incoming-calls":
    case "lsp-outgoing-calls": {
      const { filePath, line, character } = item.arguments;
      return (
        <Div
          style={{
            display: "flex",
            whiteSpace: "pre-wrap",
          }}
        >
          <Span>
            Octo wants to run LSP {lspAction} at {filePath}:{line}:{character}
          </Span>
        </Div>
      );
    }
  }
  return null;
}
