import { t } from "structural";
import { Config } from "../config.ts";
import { Transport } from "../transports/transport-common.ts";
import { ImageInfo } from "../utils/image-utils.ts";
import { Result } from "../result.ts";

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export const USER_ABORTED_ERROR_MESSAGE = "Aborted by user";

export async function attempt<T>(errMessage: string, callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch {
    throw new ToolError(errMessage);
  }
}

export async function attemptUntrackedStat(
  transport: Transport,
  signal: AbortSignal,
  path: string,
) {
  return attempt(`Could not stat(${path}): does the file exist?`, async () => {
    const exists = await transport.pathExists(signal, path);
    if (!exists) throw new Error("Path doesn't exist");
  });
}

export async function attemptUntrackedRead(
  transport: Transport,
  signal: AbortSignal,
  path: string,
) {
  return await attempt(`${path} couldn't be read`, async () => {
    return transport.readFile(signal, path);
  });
}

// Used by some edit tools to add the original file contents to the parsed data for diff tracking
export async function parseOriginalFile<
  Name extends string,
  Arguments extends { filePath: string },
>(
  signal: AbortSignal,
  transport: Transport,
  original: Schema<Name, Arguments>,
): Promise<
  Result<ParseResult<Name, Arguments, Arguments & { originalFileContents: string }>, string>
> {
  try {
    const contents = await attemptUntrackedRead(transport, signal, original.arguments.filePath);
    return {
      success: true,
      data: {
        original,
        parsed: {
          name: original.name,
          arguments: {
            ...original.arguments,
            originalFileContents: contents,
          },
        },
      },
    };
  } catch (e) {
    if (e instanceof ToolError) {
      return {
        success: false,
        error: e.message,
      };
    }
    throw e;
  }
}

export type ToolResult = {
  content: string;

  // The line count to show in the UI, if it's not just the number of lines in the content
  lines?: number;

  image?: ImageInfo;
};

type Schema<Name extends string, Arguments> = {
  name: Name;
  arguments: Arguments;
};

export type ParseResult<Name extends string, Arguments, Parsed> = {
  original: Schema<Name, Arguments>;
  parsed: Schema<Name, Parsed>;
};

export type ToolDef<Name extends string, Arguments, Parsed> = {
  ArgumentsSchema: t.Type<Arguments>;
  ParsedSchema: t.Type<Parsed>;
  Schema: t.Type<Schema<Name, Arguments>>;
  parse: (
    abortSignal: AbortSignal,
    transport: Transport,
    original: Schema<Name, Arguments>,
  ) => Promise<Result<ParseResult<Name, Arguments, Parsed>, string>>;
  validate: (
    abortSignal: AbortSignal,
    transport: Transport,
    t: Schema<Name, Arguments>,
    cfg: Config,
  ) => Promise<null>;
  run: (
    abortSignal: AbortSignal,
    transport: Transport,
    t: {
      original: Schema<Name, Arguments>;
      parsed: Schema<Name, Parsed>;
    },
    cfg: Config,
    modelOverride: string | null,
  ) => Promise<ToolResult>;
};

export type ToolFactory<S extends Schema<any, any>, Parsed> = (
  signal: AbortSignal,
  transport: Transport,
  config: Config,
) => Promise<ToolDef<S["name"], S["arguments"], Parsed> | null>;

export function defineTool<T extends Schema<any, any>, Parsed>(
  _1: t.Type<T>,
  _2: t.Type<Parsed>,
  factory: ToolFactory<T, Parsed>,
): ToolFactory<T, Parsed> {
  return factory;
}

// An uglier way to define tools, since you need to specify the actual types somewhere
// Useful for dynamically-shaped tools, where the schemas change based on runtime code
export function dynamicDefineTool<Name extends string, T extends Schema<Name, any>, Parsed>(
  _: Name,
  factory: ToolFactory<T, Parsed>,
): ToolFactory<T, Parsed> {
  return factory;
}

export type ParsedToolSchemaFrom<T extends ToolFactory<any, any>> =
  T extends ToolFactory<infer S, infer P> ? Schema<S["name"], P> : never;

export function autoparse<Name extends string, Args>(
  ArgSchema: t.Type<Args>,
): {
  parse: (
    abortSignal: AbortSignal,
    transport: Transport,
    args: Schema<Name, Args>,
  ) => Promise<Result<ParseResult<Name, Args, Args>, string>>;
  ParsedSchema: t.Type<Args>;
} {
  return {
    parse: async (_1, _2, input) => ({ success: true, data: { original: input, parsed: input } }),
    ParsedSchema: ArgSchema,
  };
}
