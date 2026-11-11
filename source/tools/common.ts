import { Transport } from "../libocto/transport.ts";
import { err, Result, ok } from "../libocto/result.ts";

export const USER_ABORTED_ERROR_MESSAGE = "Aborted by user";
export const FILE_OUTDATED_ERROR_MESSAGE =
  "File could not be updated because it was modified after being last read. Please read the file again before modifying it.";

export async function attemptUntrackedStat(
  transport: Transport,
  signal: AbortSignal,
  path: string,
): Promise<Result<null, string>> {
  const exists = await transport.pathExists(signal, path);
  if (!exists.success) return exists;
  if (!exists.data) return err(`Could not stat(${path}): does the file exist?`);
  return ok(null);
}

export async function attemptUntrackedRead(
  transport: Transport,
  signal: AbortSignal,
  path: string,
): Promise<Result<string, string>> {
  return transport.readFile(signal, path);
}

// Used by some edit tools to add the original file contents to the parsed data for diff tracking
export async function parseOriginalFile<Arguments extends { filePath: string }>(
  signal: AbortSignal,
  transport: Transport,
  original: Arguments,
): Promise<
  Result<{ original: Arguments; parsed: Arguments & { originalFileContents: string } }, string>
> {
  const contents = await attemptUntrackedRead(transport, signal, original.filePath);
  if (!contents.success) return contents;
  return ok({
    original,
    parsed: {
      ...original,
      originalFileContents: contents.data,
    },
  });
}
