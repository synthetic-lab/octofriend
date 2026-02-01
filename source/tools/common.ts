import { t } from "structural";
import { Config } from "../config.ts";
import { error } from "../logger.ts";
import { Transport } from "../transports/transport-common.ts";

export class ToolError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
    if (cause) {
      this.cause = cause;
    }
  }
}

export const USER_ABORTED_ERROR_MESSAGE = "Aborted by user";

export async function attempt<T>(errMessage: string, callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (e) {
    const originalError = e instanceof Error ? e.message : String(e);
    error("info", `[ToolError] ${errMessage}`, { originalError });
    throw new ToolError(errMessage, e);
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

export type ToolResult = {
  content: string;

  // The line count to show in the UI, if it's not just the number of lines in the content
  lines?: number;
};

export type ToolDef<T> = {
  ArgumentsSchema: t.Type<any>;
  Schema: t.Type<T>;
  validate: (abortSignal: AbortSignal, transport: Transport, t: T, cfg: Config) => Promise<null>;
  run: (
    abortSignal: AbortSignal,
    transport: Transport,
    t: T,
    cfg: Config,
    modelOverride: string | null,
  ) => Promise<ToolResult>;
};

export type ToolFactory<T> = (
  signal: AbortSignal,
  transport: Transport,
  config: Config,
  planFilePath: string | null,
) => Promise<ToolDef<T> | null>;

export function defineTool<T>(factory: ToolFactory<T>): ToolFactory<T> {
  return factory;
}

export type ToolSchemaFrom<T extends ToolFactory<any>> = T extends ToolFactory<infer T> ? T : never;

export const PLAN_MODE_MESSAGE = `
You are currently in plan mode. You cannot make edits to the codebase while in plan mode.

Your goal is to write an implementation plan to the plan file. Please focus on exploring
the codebase and iterating on your plan. When you're ready to implement, the user will
exit plan mode to begin implementation.

Use the write-plan tool to save your implementation plan.
`.trim();

export function createPlanModeToolResult(): ToolResult {
  return {
    content: PLAN_MODE_MESSAGE,
  };
}
