import { Box, Text } from "ink";

export type LspToolName = `lsp-${string}`;

export type LspToolArguments = {
	filePath?: string;
	line?: number;
	character?: number;
};

export type LspToolParsedSchema = {
	name: LspToolName;
	arguments: LspToolArguments;
};

const LSP_TOOL_ACTION_NAMES: Partial<Record<LspToolName, string>> = {
	"lsp-definition": "definition",
	"lsp-references": "references",
	"lsp-hover": "hover",
	"lsp-diagnostics": "diagnostics",
	"lsp-document-symbol": "document symbol",
	"lsp-implementation": "implementation",
	"lsp-incoming-calls": "incoming calls",
	"lsp-outgoing-calls": "outgoing calls",
};

const POSITIONED_LSP_TOOL_NAMES = new Set<LspToolName>([
	"lsp-definition",
	"lsp-references",
	"lsp-hover",
	"lsp-implementation",
	"lsp-incoming-calls",
	"lsp-outgoing-calls",
]);

export function getLspActionName(toolName: LspToolName): string {
	return LSP_TOOL_ACTION_NAMES[toolName] ?? "query";
}

export function LspToolRenderer({ item }: { item: LspToolParsedSchema }) {
	const lspAction = getLspActionName(item.name);

	if (POSITIONED_LSP_TOOL_NAMES.has(item.name)) {
		const { filePath, line, character } = item.arguments;
		return (
			<Box>
				<Text>
					Octo wants to run LSP {lspAction} at {filePath}:{line}:{character}
				</Text>
			</Box>
		);
	}

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
		default:
			return null;
	}
}
