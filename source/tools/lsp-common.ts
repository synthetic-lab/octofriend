import { t } from "structural";
import { attempt, ToolError } from "./common.ts";
import { fileTracker } from "./file-tracker.ts";
import { LspClient } from "../lsp/client.ts";
import type { Config } from "../config.ts";
import type { Transport } from "../transports/transport-common.ts";
import {
  getLspClientForFile,
  isLspGloballyDisabled,
  getUsableLspExtensions,
} from "../lsp/detect.ts";

const LSP_TOOL_ACTION_NAMES: Record<string, string> = {
  "lsp-definition": "definition",
  "lsp-references": "references",
  "lsp-hover": "hover",
  "lsp-diagnostics": "diagnostics",
  "lsp-document-symbol": "document symbol",
  "lsp-implementation": "implementation",
  "lsp-incoming-calls": "incoming calls",
  "lsp-outgoing-calls": "outgoing calls",
};

export function isLspTool(name: string): boolean {
  return name in LSP_TOOL_ACTION_NAMES;
}

export function getLspActionName(toolName: string): string {
  return LSP_TOOL_ACTION_NAMES[toolName] ?? toolName.replace("lsp-", "");
}

export const LineSchema = t.num.comment("1-indexed line number");
export const CharSchema = t.num.comment("1-indexed column number");

export function getLspExtensionsComment(extensions: Set<string>): string {
  const extensionList = Array.from(extensions).sort().join(", ");
  return `Only works on ${extensionList} files; this tool will fail on other file types.`;
}

export const LspPositionArgumentsSchema = t.subtype({
  filePath: t.str.comment("Path to the file to query"),
  line: LineSchema,
  character: CharSchema,
});

export type LspPositionArgs = t.GetType<typeof LspPositionArgumentsSchema>;

type BootstrapResult =
  | { ok: true; client: LspClient }
  | { ok: false; message: { content: string } };

export async function bootstrapLspClient(
  transport: Transport,
  config: Config,
  filePath: string,
): Promise<BootstrapResult> {
  const lspClientResult = await getLspClientForFile(transport.cwd, config, filePath);
  if (lspClientResult == null) {
    return {
      ok: false,
      message: {
        content:
          "No LSP server available for this file type. Fall back to other approaches like reading files directly.",
      },
    };
  }
  return { ok: true, client: lspClientResult };
}

export async function withLspFile<R>(
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

export async function runLspPositionQuery<R>(
  abortSignal: AbortSignal,
  transport: Transport,
  config: Config,
  args: LspPositionArgs,
  toolName: string,
  queryFn: (client: LspClient, filePath: string, line: number, character: number) => Promise<R>,
  formatResult: (result: R, filePath: string, line: number, character: number) => string,
): Promise<{ content: string }> {
  const { filePath, line, character } = args;
  const resolvedPath = await transport.resolvePath(abortSignal, filePath);

  return attempt(`LSP ${toolName} failed for ${resolvedPath}`, async () => {
    const boot = await bootstrapLspClient(transport, config, resolvedPath);
    if (!boot.ok) return boot.message;
    const { client } = boot;
    return withLspFile(abortSignal, transport, client, resolvedPath, async client => {
      const result = await queryFn(client, resolvedPath, line - 1, character - 1);
      return {
        content: formatResult(result, resolvedPath, line, character),
      };
    });
  });
}

export const LspFileOnlyArgumentsSchema = t.subtype({
  filePath: t.str.comment("Path to the file to query"),
});

export type LspFileOnlyArgs = t.GetType<typeof LspFileOnlyArgumentsSchema>;

export async function runLspFileQuery<R>(
  abortSignal: AbortSignal,
  transport: Transport,
  config: Config,
  args: LspFileOnlyArgs,
  toolName: string,
  queryFn: (client: LspClient, filePath: string) => Promise<R>,
  formatResult: (result: R, filePath: string) => string,
): Promise<{ content: string }> {
  const { filePath } = args;
  const resolvedPath = await transport.resolvePath(abortSignal, filePath);

  return attempt(`LSP ${toolName} failed for ${resolvedPath}`, async () => {
    const boot = await bootstrapLspClient(transport, config, resolvedPath);
    if (!boot.ok) return boot.message;
    const { client } = boot;
    return withLspFile(abortSignal, transport, client, resolvedPath, async client => {
      const result = await queryFn(client, resolvedPath);
      return {
        content: formatResult(result, resolvedPath),
      };
    });
  });
}
