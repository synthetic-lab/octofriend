import { t } from "structural";
import { Config } from "../config.ts";
import { Transport } from "../transports/transport-common.ts";

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

export async function attemptUntrackedStat(transport: Transport, signal: AbortSignal, path: string) {
  return attempt(`Could not stat(${path}): does the file exist?`, async () => {
    const exists = await transport.pathExists(signal, path);
    if(!exists) throw new Error("Path doesn't exist");
  });
}

export async function attemptUntrackedRead(transport: Transport, signal: AbortSignal, path: string) {
  return await attempt(`${path} couldn't be read`, async () => {
    return transport.readFile(signal, path);
  });
}

export type ToolResult = {
  content: string,

  // The line count to show in the UI, if it's not just the number of lines in the content
  lines?: number,
};

export type ToolDef<T> = {
  ArgumentsSchema: t.Type<any>,
  Schema: t.Type<T>,
  validate: (abortSignal: AbortSignal, transport: Transport, t: T, cfg: Config) => Promise<null>,
  run: (
    abortSignal: AbortSignal,
    transport: Transport,
    t: T,
    cfg: Config,
    modelOverride: string | null,
  ) => Promise<ToolResult>,
};
