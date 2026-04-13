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
import {
  getLspClientForFile,
  isLspGloballyDisabled,
  getUsableLspExtensions,
} from "../../lsp/detect.ts";

const LineSchema = t.num.comment("1-indexed line number");
const CharSchema = t.num.comment("1-indexed column number");

const positionFields = {
  line: LineSchema,
  character: CharSchema,
} as const;

const DefinitionSchema = t.subtype({
  lspActionName: t.value("definition").comment("location where a symbol was originally defined"),
  ...positionFields,
});

const ReferencesSchema = t.subtype({
  lspActionName: t.value("references").comment("find all references to a symbol"),
  ...positionFields,
});

const HoverSchema = t.subtype({
  lspActionName: t.value("hover").comment("type info and documentation for a symbol"),
  ...positionFields,
});

const ImplementationSchema = t.subtype({
  lspActionName: t
    .value("implementation")
    .comment("jumps past interfaces and abstract classes to the code that implements them"),
  ...positionFields,
});

const IncomingCallsSchema = t.subtype({
  lspActionName: t.value("incomingCalls").comment("find callers of a symbol"),
  ...positionFields,
});

const OutgoingCallsSchema = t.subtype({
  lspActionName: t.value("outgoingCalls").comment("find callees of a symbol"),
  ...positionFields,
});

const DiagnosticsSchema = t.subtype({
  lspActionName: t.value("diagnostics").comment("errors and warnings for a file"),
});

const DocumentSymbolSchema = t.subtype({
  lspActionName: t.value("documentSymbol").comment("list all symbols in a file"),
});

const ArgumentsSchema = t.subtype({
  filePath: t.str.comment("Path to the file to query"),
  action: DefinitionSchema.or(ReferencesSchema)
    .or(HoverSchema)
    .or(ImplementationSchema)
    .or(IncomingCallsSchema)
    .or(OutgoingCallsSchema)
    .or(DiagnosticsSchema)
    .or(DocumentSymbolSchema),
});

type LspToolCall = { name: "lsp"; arguments: t.GetType<typeof ArgumentsSchema> };
export type LspToolCallArgs = t.GetType<typeof ArgumentsSchema>;

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
  if (isLspGloballyDisabled(config)) return null;

  const extensions = getUsableLspExtensions(config);
  if (extensions.size === 0) return null;

  const Schema = t
    .subtype({
      name: t.value("lsp"),
      arguments: ArgumentsSchema,
    })
    .comment(
      `Query a running Language Server for code intelligence. Use this tool INSTEAD of reading files when you need type info, definitions, references, or symbol lookups since it is faster and more accurate than reading and searching manually. Inspect the action parameter's options and their descriptions to determine which action to use. Only use this tool for files with these extensions: ${[...extensions].join(", ")}`,
    );

  return {
    Schema,
    ArgumentsSchema,
    validate: async () => null,

    async run(abortSignal, transport, call, config) {
      const { action, filePath } = call.arguments;

      const resolvedPath = await transport.resolvePath(abortSignal, filePath);

      return attempt(`LSP ${action.lspActionName} failed for ${resolvedPath}`, async () => {
        const boot = await bootstrapClient(transport, config, resolvedPath);
        if (!boot.ok) return boot.message;
        const { client } = boot;
        return withLspFile(abortSignal, transport, client, resolvedPath, async client => {
          switch (action.lspActionName) {
            case "definition": {
              const { line, character } = action;
              const locations = await client.getDefinition(resolvedPath, line - 1, character - 1);
              return {
                content: `Definition results for ${resolvedPath}:${line}:${character}:\n${formatLocations(locations)}`,
              };
            }

            case "references": {
              const { line, character } = action;
              const refs = await client.getReferences(resolvedPath, line - 1, character - 1);
              return {
                content: `References for symbol at ${resolvedPath}:${line}:${character}:\n${formatLocations(refs)}`,
              };
            }

            case "hover": {
              const { line, character } = action;
              const hover = await client.getHover(resolvedPath, line - 1, character - 1);
              return {
                content: `Hover info for ${resolvedPath}:${line}:${character}:\n${hover ?? "No hover information available."}`,
              };
            }

            case "diagnostics": {
              const diagnosticsMinVersion = client.getDiagnosticsVersion();
              const diagnostics = await client.getDiagnostics(resolvedPath, diagnosticsMinVersion);
              return {
                content: `Diagnostics for ${resolvedPath}:\n${formatDiagnostics(diagnostics)}`,
              };
            }

            case "implementation": {
              const { line, character } = action;
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
              const { line, character } = action;
              const calls = await client.getIncomingCalls(resolvedPath, line - 1, character - 1);
              return {
                content: `Incoming calls to symbol at ${resolvedPath}:${line}:${character}:\n${formatCallHierarchy(calls, "incoming")}`,
              };
            }

            case "outgoingCalls": {
              const { line, character } = action;
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
