import React from "react";
import { Text, Box } from "ink";
import { ToolCall } from "../tools/index.ts";

type LspToolParsedSchema = Extract<ToolCall["parsed"], { name: `lsp-${string}` }>;
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
  return LSP_TOOL_ACTION_NAMES[toolName];
}

export function LspToolRenderer({ item }: { item: LspToolParsedSchema }) {
  const lspAction = getLspActionName(item.name);

  switch (item.name) {
    case "lsp-diagnostics":
    case "lsp-document-symbol":
      return (
        <Box>
          <Text>
            Octo wants to run LSP {lspAction} on {item.arguments.filePath}
          </Text>
        </Box>
      );
    case "lsp-definition":
    case "lsp-references":
    case "lsp-hover":
    case "lsp-implementation":
    case "lsp-incoming-calls":
    case "lsp-outgoing-calls": {
      const { filePath, line, character } = item.arguments;
      return (
        <Box>
          <Text>
            Octo wants to run LSP {lspAction} at {filePath}:{line}:{character}
          </Text>
        </Box>
      );
    }
  }
}
