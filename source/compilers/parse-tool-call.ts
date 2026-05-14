import { toTypescript } from "structural";
import { JsonFixResponse } from "../prompts/autofix-prompts.ts";
import { ToolCallRequest } from "../ir/llm-ir.ts";
import { ToolDef } from "../tools/common.ts";
import { Transport } from "../transports/transport-common.ts";
import * as logger from "../logger.ts";
import { tryexpr } from "../tryexpr.ts";

export type ParsedToolCallResult =
  | {
      status: "success";
      tool: ToolCallRequest;
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

export async function parseToolCall({
  toolCall,
  toolDefs,
  autofixJson,
  abortSignal,
  transport,
}: {
  toolCall: ToolCallToParse;
  toolDefs: Partial<Record<string, ToolDef<any, any, any>>>;
  autofixJson: (badJson: string, signal: AbortSignal) => Promise<JsonFixResponse>;
  abortSignal: AbortSignal;
  transport: Transport;
}): Promise<ParsedToolCallResult> {
  const name = toolCall.toolName;
  const toolDef = toolDefs[name];

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

  const toolSchema = toolDef.Schema;
  let args = toolCall.args;

  if (typeof args === "string") {
    const parsedArgs = await parseJsonArguments(args, autofixJson, abortSignal);
    if (!parsedArgs.success) return parsedArgs;
    args = parsedArgs.args;
  }

  try {
    const sliced = toolSchema.slice({
      name,
      arguments: args,
    });
    const parsed = await toolDef.parse(abortSignal, transport, sliced);

    if (parsed.success) {
      return {
        status: "success",
        tool: {
          type: "tool-request",
          call: parsed.data,
          toolCallId: toolCall.toolCallId,
        },
      };
    }
    return {
      status: "error",
      message: parsed.error,
    };
  } catch (e: unknown) {
    logger.error("verbose", e);
    logger.error("verbose", toolCall);
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
  autofixJson: (badJson: string, signal: AbortSignal) => Promise<JsonFixResponse>,
  abortSignal: AbortSignal,
): Promise<
  { success: true; args: unknown } | { success: false; status: "error"; message: string }
> {
  const source = rawArgs === "" ? "{}" : rawArgs;
  let [err, args] = tryexpr(() => JSON.parse(source));

  if (err) {
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
    const [doubleEncodedErr, doubleDecodedArgs] = tryexpr(() => JSON.parse(args));
    if (!doubleEncodedErr) args = doubleDecodedArgs;
  }

  return { success: true, args };
}
