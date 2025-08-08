import { t } from "structural";
import * as fs from "fs/promises";
import { SequenceIdTagged } from "../history.ts";
import { Config } from "../config.ts";

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

export async function attemptUntrackedStat(path: string) {
  return attempt(`Could not stat(${path}): does the file exist?`, async () => {
    return await fs.stat(path);
  });
}

export async function attemptUntrackedRead(path: string) {
  return await attempt(`${path} couldn't be read`, async () => {
    return fs.readFile(path, "utf8");
  });
}

export type ToolDef<T> = {
  ArgumentsSchema: t.Type<any>,
  Schema: t.Type<T>,
  validate: (t: T, cfg: Config) => Promise<null>,
  run: (
    abortSignal: AbortSignal,
    t: SequenceIdTagged<{ tool: T }>,
    cfg: Config,
    modelOverride: string | null,
  ) => Promise<string>,
};
