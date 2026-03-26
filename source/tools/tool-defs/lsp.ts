import { t } from "structural";
import { attempt, defineTool, ToolError } from "../common.ts";
import { fileTracker } from "../file-tracker.ts";
import {
  formatLocations,
  formatDiagnostics,
  formatDocumentSymbols,
  formatCallHierarchy,
  LspClient,
} from "../../lsp/client.ts";
import type { Config } from "../../config.ts";
import type { Transport } from "../../transports/transport-common.ts";
import { getLspClientForFile, isLspGloballyDisabled } from "../../lsp/detect.ts";

const ArgumentsSchema = t.subtype({
  filePath: t.str.comment("Path to the file to query"),
  line: t.optional(
    t.num.comment(
      "1-indexed line number (required for definition, references, hover, implementation, incomingCalls, outgoingCalls)",
    ),
  ),
  character: t.optional(
    t.num.comment(
      "1-indexed column number (required for definition, references, hover, implementation, incomingCalls, outgoingCalls)",
    ),
  ),
  action: t
    .value("definition")
    .comment("location where a symbol was originally defined. Requires file, line, character")
    .or(
      t
        .value("references")
        .comment("find all references to a symbol. Requires file, line, character"),
    )
    .or(
      t
        .value("hover")
        .comment("type info and documentation for a symbol. Requires file, line, character"),
    )
    .or(t.value("diagnostics").comment("errors and warnings for a file. Requires file only"))
    .or(
      t
        .value("implementation")
        .comment(
          "similar to getDefinition, but jumps past interfaces and abstract classes to the code that implements them. Requires file, line, character",
        ),
    )
    .or(t.value("documentSymbol").comment("list all symbols in a file. Requires file only"))
    .or(
      t.value("incomingCalls").comment("find callers of a symbol. Requires file, line, character"),
    )
    .or(
      t.value("outgoingCalls").comment("find callees of a symbol. Requires file, line, character"),
    ),
});

const Schema = t
  .subtype({
    name: t.value("lsp"),
    arguments: ArgumentsSchema,
  })
  .comment(
    "Query a running Language Server for code intelligence. Use this tool INSTEAD of reading files when you need type info, definitions, references, or symbol lookups since it is faster and more accurate than reading and searching manually. Inspect the action parameter's options and their descriptions to determine which action to use.",
  );

type LspToolCall = t.GetType<typeof Schema>;
export type LspToolCallArgs = t.GetType<typeof ArgumentsSchema>;

function requireFilePath(call: LspToolCall): string {
  const { filePath, action } = call.arguments;
  if (!filePath) {
    throw new ToolError(`"${action}" requires a filePath argument`);
  }
  return filePath;
}

function requirePosition(call: LspToolCall): { line: number; character: number } {
  const { line, character, action } = call.arguments;
  if (line == null || character == null) {
    throw new ToolError(`"${action}" requires both line and character arguments`);
  }
  return { line, character };
}

const unavailableMessage = {
  content:
    "No LSP server available for this file type. Fall back to other approaches like reading files directly.",
};

type BootstrapResult =
  | { ok: true; client: LspClient }
  | { ok: false; message: { content: string } };

async function bootstrapClient(
  transport: Transport,
  config: Config,
  filePath: string,
): Promise<BootstrapResult> {
  const lspClientResult = await getLspClientForFile(transport.cwd, config, filePath);
  if (lspClientResult == null) {
    return { ok: false, message: unavailableMessage };
  }
  return { ok: true, client: lspClientResult };
}

async function withLspFile<R>(
  abortSignal: AbortSignal,
  transport: Transport,
  client: LspClient,
  filePath: string,
  fn: (client: LspClient) => Promise<R>,
): Promise<R> {
  const content = await fileTracker.read(transport, abortSignal, filePath);
  try {
    await client.openFile(filePath, content);
    return await fn(client);
  } catch {
    throw new ToolError(`LSP client failed to process ${filePath}`);
  }
}

export default defineTool<LspToolCall>(async (_signal, _transport, config) => {
  // Check if LSP disabled in Global Config
  if (isLspGloballyDisabled(config)) return null;

  return {
    Schema,
    ArgumentsSchema,
    validate: async () => null,

    async run(abortSignal, transport, call, config) {
      const { action } = call.arguments;

      const filePath = requireFilePath(call);
      const resolvedPath = await transport.resolvePath(abortSignal, filePath);

      return attempt(`LSP ${action} failed for ${resolvedPath}`, async () => {
        const boot = await bootstrapClient(transport, config, resolvedPath);
        if (!boot.ok) return boot.message;
        const { client } = boot;
        return withLspFile(abortSignal, transport, client, resolvedPath, async client => {
          switch (action) {
            case "definition": {
              const { line, character } = requirePosition(call);
              const locations = await client.getDefinition(resolvedPath, line - 1, character - 1);
              return {
                content: `Definition results for ${resolvedPath}:${line}:${character}:\n${formatLocations(locations)}`,
              };
            }

            case "references": {
              const { line, character } = requirePosition(call);
              const refs = await client.getReferences(resolvedPath, line - 1, character - 1);
              return {
                content: `References for symbol at ${resolvedPath}:${line}:${character}:\n${formatLocations(refs)}`,
              };
            }

            case "hover": {
              const { line, character } = requirePosition(call);
              const hover = await client.getHover(resolvedPath, line - 1, character - 1);
              return {
                content: `Hover info for ${resolvedPath}:${line}:${character}:\n${hover ?? "No hover information available."}`,
              };
            }

            case "diagnostics": {
              // used to ensure we don't return the previous diagnostics after a file change/open
              const diagnosticsMinVersion = client.getDiagnosticsVersion();
              const diagnostics = await client.getDiagnostics(resolvedPath, diagnosticsMinVersion);
              return {
                content: `Diagnostics for ${resolvedPath}:\n${formatDiagnostics(diagnostics)}`,
              };
            }

            case "implementation": {
              const { line, character } = requirePosition(call);
              const locations = await client.getImplementation(
                resolvedPath,
                line - 1,
                character - 1,
              );
              return {
                content: `Implementation results for ${resolvedPath}:${line}:${character}:\n${formatLocations(locations)}`,
              };
            }

            case "documentSymbol": {
              const symbols = await client.getDocumentSymbols(resolvedPath);
              return { content: `Symbols in ${resolvedPath}:\n${formatDocumentSymbols(symbols)}` };
            }

            case "incomingCalls": {
              const { line, character } = requirePosition(call);
              const calls = await client.getIncomingCalls(resolvedPath, line - 1, character - 1);
              return {
                content: `Incoming calls to symbol at ${resolvedPath}:${line}:${character}:\n${formatCallHierarchy(calls, "incoming")}`,
              };
            }

            case "outgoingCalls": {
              const { line, character } = requirePosition(call);
              const calls = await client.getOutgoingCalls(resolvedPath, line - 1, character - 1);
              return {
                content: `Outgoing calls from symbol at ${resolvedPath}:${line}:${character}:\n${formatCallHierarchy(calls, "outgoing")}`,
              };
            }

            default: {
              const _unreachable: never = action;
              throw new ToolError(`Unknown LSP action: ${_unreachable}`);
            }
          }
        });
      });
    },
  };
});
