import { t } from "structural";
import { fileTracker } from "./file-tracker.ts";
import { LspClient } from "../lsp/client.ts";
import type { Config } from "../config.ts";
import type { Transport } from "../libocto/transport.ts";
import { getLspClientForFile } from "../lsp/detect.ts";
import { Result, ok, err } from "../libocto/result.ts";

export type LspFileOnlyArgs = t.GetType<typeof LspFileOnlyArgumentsSchema>;
export const LspFileOnlyArgumentsSchema = t.subtype({
  filePath: t.str.comment("Path to the file to query"),
});

export const LineSchema = t.num.comment("1-indexed line number");
export const CharSchema = t.num.comment("1-indexed column number");

export const LspPositionArgumentsSchema = t.subtype({
  filePath: t.str.comment("Path to the file to query"),
  line: LineSchema,
  character: CharSchema,
});

export type LspPositionArgs = t.GetType<typeof LspPositionArgumentsSchema>;

export function getLspExtensionsComment(extensions: Set<string>): string {
  const extensionList = Array.from(extensions).sort().join(", ");
  return `Only works on ${extensionList} files; this tool will fail on other file types.`;
}

const NO_LSP_SERVER_MESSAGE =
  "No LSP server available for this file type. Fall back to other approaches like reading files directly.";

export async function bootstrapLspClient(
  abortSignal: AbortSignal,
  transport: Transport,
  config: Config,
  filePath: string,
): Promise<Result<LspClient | null, string>> {
  return getLspClientForFile(abortSignal, transport.cwd, config, filePath, transport);
}

export async function withLspFile<R>(
  abortSignal: AbortSignal,
  transport: Transport,
  client: LspClient,
  filePath: string,
  fn: (client: LspClient) => Promise<Result<R, string>>,
): Promise<Result<R, string>> {
  const content = await fileTracker.read(transport, abortSignal, filePath);
  if (!content.success) return content;
  await client.openFile(filePath, content.data);
  const result = await fn(client);
  if (result.success) return result;
  return err(`LSP query failed for ${filePath}: ${result.error}`);
}

export async function runLspPositionQuery<R>(
  abortSignal: AbortSignal,
  transport: Transport,
  config: Config,
  args: LspPositionArgs,
  toolName: string,
  queryFn: (
    client: LspClient,
    filePath: string,
    line: number,
    character: number,
  ) => Promise<Result<R, string>>,
  formatResult: (result: R, filePath: string, line: number, character: number) => string,
): Promise<Result<{ content: string }, string>> {
  const { filePath, line, character } = args;
  const resolvedPath = await transport.resolvePath(abortSignal, filePath);
  if (!resolvedPath.success) return resolvedPath;

  const boot = await bootstrapLspClient(abortSignal, transport, config, resolvedPath.data);
  if (!boot.success) return boot;
  if (boot.data == null) return ok({ content: NO_LSP_SERVER_MESSAGE });

  return withLspFile(abortSignal, transport, boot.data, resolvedPath.data, async client => {
    const result = await queryFn(client, resolvedPath.data, line - 1, character - 1);
    return result.map(r => ({
      content: formatResult(r, resolvedPath.data, line, character),
    }));
  });
}

export async function runLspFileQuery<R>(
  abortSignal: AbortSignal,
  transport: Transport,
  config: Config,
  args: LspFileOnlyArgs,
  toolName: string,
  queryFn: (client: LspClient, filePath: string) => Promise<Result<R, string>>,
  formatResult: (result: R, filePath: string) => string,
): Promise<Result<{ content: string }, string>> {
  const { filePath } = args;
  const resolvedPath = await transport.resolvePath(abortSignal, filePath);
  if (!resolvedPath.success) return resolvedPath;

  const boot = await bootstrapLspClient(abortSignal, transport, config, resolvedPath.data);
  if (!boot.success) return boot;
  if (boot.data == null) return ok({ content: NO_LSP_SERVER_MESSAGE });

  return withLspFile(abortSignal, transport, boot.data, resolvedPath.data, async client => {
    const result = await queryFn(client, resolvedPath.data);
    return result.map(r => ({
      content: formatResult(r, resolvedPath.data),
    }));
  });
}
