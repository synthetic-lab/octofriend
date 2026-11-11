import { toTypescript } from "structural";
import type { JsonFixResponse } from "./compiler-interface.ts";
import type { LoadedTools, ToolCall, ToolMap } from "../tools/tool-def.ts";
import { Transport } from "../transport.ts";
import { logger } from "../logger.ts";
import { attemptSync } from "../result.ts";

export type ParsedToolCallResult<T extends ToolMap<any, any>> =
  | {
      status: "success";
      tool: ToolCall<T>;
    }
  | {
      status: "error";
      message: string;
    };

export type ToolCallToParse = {
  toolCallId: string;
  toolName: string;
  args: unknown;
};

export async function parseToolCall<T extends ToolMap<any, any>>({
  toolCall,
  toolDefs,
  autofixJson,
  abortSignal,
  transport,
}: {
  toolCall: ToolCallToParse;
  toolDefs: Partial<LoadedTools<T>>;
  autofixJson?: (badJson: string, signal: AbortSignal) => Promise<JsonFixResponse>;
  abortSignal: AbortSignal;
  transport: Transport;
}): Promise<ParsedToolCallResult<T>> {
  const name = toolCall.toolName;
  const toolDefsByName = toolDefs as Partial<Record<string, LoadedTools<T>[keyof LoadedTools<T>]>>;
  const toolDef = toolDefsByName[name];

  if (!toolDef) {
    return {
      status: "error",
      message: `
Unknown tool ${name}. The only valid tool names are:

- ${Object.keys(toolDefs).join("\n- ")}

Please try calling a valid tool.
      `.trim(),
    };
  }

  const toolSchema = toolDef.ArgumentsSchema;
  let args = toolCall.args;

  if (typeof args === "string") {
    const parsedArgs = await parseJsonArguments(args, autofixJson, abortSignal);
    if (!parsedArgs.success) {
      return {
        status: "error",
        message: parsedArgs.message,
      };
    }
    args = parsedArgs.args;
  }

  try {
    const original = toolSchema.slice(args);
    const parsed = await toolDef.parse({ signal: abortSignal, transport, original });

    if (parsed.success) {
      return {
        status: "success",
        tool: {
          type: "tool-call",
          name,
          original: parsed.data.original,
          parsed: parsed.data.parsed,
          toolCallId: toolCall.toolCallId,
        } as ToolCall<T>,
      };
    }
    return {
      status: "error",
      message: parsed.error,
    };
  } catch (e: unknown) {
    logger.log.error(e);
    logger.log.error(toolCall);
    const error = e instanceof Error ? e.message : "Invalid arguments in tool call";
    return {
      status: "error",
      message: `
Failed to parse tool call: ${error}. Make sure your arguments are valid and match the expected format.

Your arguments were:
${JSON.stringify(args)}

Expected:
${toTypescript(toolSchema)}
      `.trim(),
    };
  }
}

async function parseJsonArguments(
  rawArgs: string,
  autofixJson: ((badJson: string, signal: AbortSignal) => Promise<JsonFixResponse>) | undefined,
  abortSignal: AbortSignal,
): Promise<
  { success: true; args: unknown } | { success: false; status: "error"; message: string }
> {
  const source = rawArgs === "" ? "{}" : rawArgs;
  const initialArgs = attemptSync("Invalid JSON", () => JSON.parse(source));
  let args = initialArgs.success ? initialArgs.data : undefined;

  if (!initialArgs.success) {
    if (!autofixJson) {
      return {
        success: false,
        status: "error",
        message: "Syntax error: invalid JSON in tool call arguments",
      };
    }

    const fixResponse = await autofixJson(source, abortSignal);
    if (!fixResponse.success) {
      return {
        success: false,
        status: "error",
        message: "Syntax error: invalid JSON in tool call arguments",
      };
    }
    args = fixResponse.fixed;
  }

  if (typeof args === "string") {
    const doubleDecodedArgs = attemptSync("Invalid double-encoded JSON", () => JSON.parse(args));
    if (doubleDecodedArgs.success) args = doubleDecodedArgs.data;
  }

  return { success: true, args };
}
