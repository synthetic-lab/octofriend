import type { Config } from "../config.ts";
import { Transport } from "../transports/transport-common.ts";
import { ImageInfo } from "../utils/image-utils.ts";
import { Err, Ok, Result, result } from "../result.ts";
import { tools as BASE_IR_TOOL, ToolCall, ToolMap } from "../libocto/tool-def.ts";

export const USER_ABORTED_ERROR_MESSAGE = "Aborted by user";

export async function attempt<T, E>(
  errMessage: string,
  callback: () => Promise<Result<T, E>>,
): Promise<Result<T, E | string>>;
export async function attempt<T>(
  errMessage: string,
  callback: () => Promise<T>,
): Promise<Result<T, string>>;
export async function attempt<T, E>(
  errMessage: string,
  callback: () => Promise<T | Result<T, E>>,
): Promise<Result<T, E | string>> {
  try {
    const value = await callback();
    if (value instanceof Ok || value instanceof Err) return value;
    return result.ok(value);
  } catch {
    return result.err(errMessage);
  }
}

export async function attemptUntrackedStat(
  transport: Transport,
  signal: AbortSignal,
  path: string,
): Promise<Result<null, string>> {
  return attempt(`Could not stat(${path}): does the file exist?`, async () => {
    const exists = await transport.pathExists(signal, path);
    if (!exists) throw new Error("Path doesn't exist");
    return null;
  });
}

export async function attemptUntrackedRead(
  transport: Transport,
  signal: AbortSignal,
  path: string,
): Promise<Result<string, string>> {
  return await attempt(`${path} couldn't be read`, async () => {
    return transport.readFile(signal, path);
  });
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
  return result.ok({
    original,
    parsed: {
      ...original,
      originalFileContents: contents.data,
    },
  });
}

export type ToolResult = {
  content: string;

  // The line count to show in the UI, if it's not just the number of lines in the content
  lines?: number;

  image?: ImageInfo;
};

export type FileReadIR<T extends ToolCall<any>> = {
  role: "file-read";
  content: string;
  toolCall: T;
  path: string;
  image?: ImageInfo;
};

export type FileMutateIR<T extends ToolCall<any>> = {
  role: "file-mutate";
  content: string;
  toolCall: T;
  path: string;
};

export type FileOutdatedIR<T extends ToolCall<any>> = {
  role: "file-outdated";
  toolCall: T;
  error: string;
};

export type FileUnreadableIR<T extends ToolCall<any>> = {
  role: "file-unreadable";
  path: string;
  toolCall: T;
  error: string;
};

export type FileIR<T extends ToolCall<any>> =
  | FileReadIR<T>
  | FileMutateIR<T>
  | FileOutdatedIR<T>
  | FileUnreadableIR<T>;

export const BASE_IR = BASE_IR_TOOL.withData<Config>();

export function toolOutput(content: string, options: { lines?: number; image?: ImageInfo } = {}) {
  return result.ok({
    type: "output" as const,
    content: [
      { type: "text" as const, content },
      ...(options.image ? [{ type: "image" as const, image: options.image }] : []),
    ],
    lines: options.lines,
  });
}

export function fileReadIR<T extends ToolCall<any> & { parsed: { filePath: string } }>(
  toolCall: T,
) {
  return (args: { content: string; image?: ImageInfo }): FileReadIR<T> => ({
    role: "file-read",
    content: args.content,
    toolCall,
    path: toolCall.parsed.filePath,
    image: args.image,
  });
}

export function fileMutateIR<T extends ToolCall<any> & { parsed: { filePath: string } }>(
  toolCall: T,
) {
  return (args: { content: string }): FileMutateIR<T> => ({
    role: "file-mutate",
    content: args.content,
    toolCall,
    path: toolCall.parsed.filePath,
  });
}
