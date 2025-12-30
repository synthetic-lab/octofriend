import OpenAI from "openai";
import { t, toJSONSchema, toTypescript } from "structural";
import { Compiler } from "./compiler-interface.ts";
import { StreamingXMLParser, tagged } from "../xml.ts";
import {
  LlmIR, AssistantMessage as AssistantIR, AgentResult, ToolCallRequestSchema
} from "../ir/llm-ir.ts";
import { countIRTokens } from "../ir/ir-windowing.ts";
import { fileTracker } from "../tools/file-tracker.ts";
import { tryexpr } from "../tryexpr.ts";
import { trackTokens } from "../token-tracker.ts";
import * as logger from "../logger.ts";
import { errorToString, PaymentError, RateLimitError } from "../errors.ts";
import { Transport } from "../transports/transport-common.ts";
import { compactionCompilerExplanation } from "./autocompact.ts";
import { ToolDef } from "../tools/common.ts";
import { JsonFixResponse } from "../prompts/autofix-prompts.ts";

export type UserMessage = {
  role: "user";
  content: string;
};

export type AssistantMessage = {
  role: "assistant";
  content: string;
  tool_calls?: Array<{
    type: "function",
    function: {
      arguments: string,
      name: string,
    },
    id: string,
  }>
};

export type ToolMessage = {
  role: "tool",
  content: string,
  tool_call_id: string,
};

export type SystemPrompt = {
  role: "system",
  content: string,
};

export type LlmMessage = SystemPrompt | UserMessage | AssistantMessage | ToolMessage;

const ResponseToolCallSchema = t.subtype({
  id: t.str,
  function: t.subtype({
    name: t.str,
    arguments: t.str,
  }),
});

type ResponseToolCall = t.GetType<typeof ResponseToolCallSchema>;

const TOOL_ERROR_TAG = "tool-error";

function generateCurlFrom(params: {
  baseURL: string;
  model: string;
  messages: LlmMessage[];
  tools?: any[];
}): string {
  const { baseURL, model, messages, tools } = params;

  const requestBody = {
    model,
    messages,
    tools,
    stream: true,
    stream_options: {
      include_usage: true,
    },
  };

  return `curl -X POST '${baseURL}/chat/completions' \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer [REDACTED_API_KEY]" \\
  -d @- <<'JSON'
${JSON.stringify(requestBody)}
JSON`;
}


async function toLlmMessages(
  messages: LlmIR[],
  transport: Transport,
  signal: AbortSignal,
  systemPrompt?: () => Promise<string>,
): Promise<Array<LlmMessage>> {
  const output: LlmMessage[] = [];
  const irs = [ ...messages ];

  irs.reverse();
  const seenPaths = new Set<string>();
  let prev: LlmIR | null = null;
  for(const ir of irs) {
    if(ir.role === "file-tool-output") {
      let seen = seenPaths.has(ir.path);
      seenPaths.add(ir.path);
      output.push(await llmFromIr(transport, signal, ir, prev, seen));
    }
    else {
      output.push(await llmFromIr(transport, signal, ir, prev, false));
    }
    prev = ir;
  }

  output.reverse();
  if(systemPrompt) {
    const prompt = await systemPrompt();
    output.unshift({
      role: "system",
      content: prompt,
    });
  }

  return output;
}

async function llmFromIr(
  transport: Transport, signal: AbortSignal, ir: LlmIR, prev: LlmIR | null, seenPath: boolean
): Promise<LlmMessage> {
  if(ir.role === "assistant") {
    const { toolCall } = ir;
    const reasoning: { reasoning_content?: string } = {};
    if(ir.reasoningContent) reasoning.reasoning_content = ir.reasoningContent;

    if(toolCall == null || prev?.role === "tool-malformed") {
      return {
        ...reasoning,
        role: "assistant",
        content: ir.content || " ", // Some APIs don't like zero-length content strings
      };
    }
    return {
        ...reasoning,
      role: "assistant",
      content: ir.content,
      tool_calls: [{
        type: "function",
        function: {
          name: toolCall.function.name,
          arguments: toolCall.function.arguments ? JSON.stringify(toolCall.function.arguments) : "{}",
        },
        id: toolCall.toolCallId,
      }]
    };
  }
  if(ir.role === "user") {
    return ir;
  }
  if(ir.role === "tool-output") {
    return {
      role: "tool",
      tool_call_id: ir.toolCall.toolCallId,
      content: ir.content,
    };
  }
  if(ir.role === "file-tool-output") {
    if(seenPath) {
      return {
        role: "tool",
        tool_call_id: ir.toolCall.toolCallId,
        content: "Tool ran successfully.",
      };
    }
    try {
      return {
        role: "tool",
        tool_call_id: ir.toolCall.toolCallId,
        content: await fileTracker.read(transport, signal, ir.path),
      };
    } catch {
      return {
        role: "tool",
        tool_call_id: ir.toolCall.toolCallId,
        content: "Tool ran successfully.",
      };
    }
  }
  if(ir.role === "tool-reject") {
    return {
      role: "tool",
      tool_call_id: ir.toolCall.toolCallId,
      content: tagged(TOOL_ERROR_TAG, {}, "Tool call rejected by user. Your tool call did not run."),
    };
  }
  if(ir.role === "tool-malformed") {
    return {
      role: "system",
      content: "Malformed tool call: " + tagged(TOOL_ERROR_TAG, {}, ir.error),
    };
  }
  if(ir.role === "tool-error") {
    return {
      role: "tool",
      tool_call_id: ir.toolCallId,
      content: "Error: " + tagged(TOOL_ERROR_TAG, {}, ir.error),
    };
  }
  if(ir.role === "file-outdated") {
    return {
      role: "tool",
      tool_call_id: ir.toolCall.toolCallId,
      content: `\n${tagged(TOOL_ERROR_TAG, {}, `
File could not be updated because it was modified after being last read.
The latest version of the file has been automatically re-read and placed in your context space.
Please try again.`.trim())}`,
    }
  }

  if(ir.role === "compaction-checkpoint") {
    return {
      role: "user",
      content: compactionCompilerExplanation(ir.summary),
    };
  }

  const _: "file-unreadable" = ir.role;

  return {
    role: "tool",
    tool_call_id: ir.toolCall.toolCallId,
    content: tagged(
      TOOL_ERROR_TAG,
      {},
      `File ${ir.path} could not be read. Has it been deleted?`,
    ),
  };
}


const PaymentErrorSchema = t.subtype({
  status: t.value(402),
  error: t.str,
});
const RateLimitErrorSchema = t.subtype({
  status: t.value(429),
  error: t.str,
});

const ERROR_SCHEMAS = [
  [ PaymentError, PaymentErrorSchema ] as const,
  [ RateLimitError, RateLimitErrorSchema ] as const,
];

async function handleKnownErrors(
  curl: string,
  cb: () => Promise<AgentResult>
): Promise<AgentResult> {
  try {
    return await cb();
  } catch(e) {
    for(const [ ErrorClass, schema ] of ERROR_SCHEMAS) {
      const result = schema.sliceResult(e);
      if(!(result instanceof t.Err)) throw new ErrorClass(result.error);
    }
    // If schema is not found, generate request error with associated curl
    return {
      success: false,
      requestError: errorToString(e),
      curl,
    };
  }
}

export const runAgent: Compiler = async ({
  model, apiKey, windowedIR, onTokens, abortSignal, transport, systemPrompt, autofixJson, tools
}) => {
  const messages = await toLlmMessages(
    windowedIR.ir,
    transport,
    abortSignal,
    systemPrompt,
  );

  const toolDefs = tools || {};
  const toolsMap = Object.entries(toolDefs).map(([ name, tool ]) => {
    const argJsonSchema = toJSONSchema("ignore", tool.ArgumentsSchema);
    // Delete JSON schema fields unused by OpenAI compatible APIs; some APIs will error if present
    // @ts-ignore
    delete argJsonSchema.$schema;
    delete argJsonSchema.description;
    // @ts-ignore
    delete argJsonSchema.title;

    return {
      type: "function" as const,
      function: {
        name: name,
        description: `The ${name} tool`,
        parameters: argJsonSchema,
        strict: true,
      },
    };
  });
  const toolsParam = Object.entries(toolDefs).length === 0 ? {} : {
    tools: toolsMap,
  };

  const curl = generateCurlFrom({
    baseURL: model.baseUrl,
    model: model.model,
    messages,
    ...toolsParam,
  });
  return await handleKnownErrors(curl, async () => {
    const client = new OpenAI({
      baseURL: model.baseUrl,
      apiKey,
    });

    let reasoning: {
      reasoning_effort?: "low" | "medium" | "high"
    } = {};
    if(model.reasoning) reasoning.reasoning_effort = model.reasoning;

    const res = await client.chat.completions.create({
      ...reasoning,
      model: model.model,
      messages,
      ...toolsParam,
      stream: true,
      stream_options: {
        include_usage: true,
      },
    }, {
      signal: abortSignal,
    });

    let content = "";
    let reasoningContent: undefined | string = undefined;
    let inThinkTag = false;
    let usage = {
      input: 0,
      output: 0,
    };

    const xmlParser = new StreamingXMLParser({
      whitelist: [ "think" ],
      handlers: {
        onOpenTag: () => {
          if(content === "") inThinkTag = true;
        },

        onCloseTag: () => {
          inThinkTag = false;
        },

        onText: e => {
          if(inThinkTag) {
            if(reasoningContent == null) reasoningContent = "";
            reasoningContent += e.content;
            onTokens(e.content, "reasoning");
          }
          else {
            onTokens(e.content, "content");
            content += e.content;
          }
        },
      },
    });

    let currTool: Partial<ResponseToolCall> | null = null;
    let doneParsingTools = false;

    try {
      for await(const chunk of res) {
        if (abortSignal.aborted) break;
        if(doneParsingTools) break;
        if(chunk.usage) {
          usage.input = chunk.usage.prompt_tokens;
          usage.output = chunk.usage.completion_tokens;
        }

        const delta = chunk.choices[0]?.delta as {
          content: string
        } | {
          reasoning_content: string
        } | {
          tool_calls: Array<ResponseToolCall>
        } | null;

        if(delta && "content" in delta && delta.content) {
          const tokens = delta.content || "";
          xmlParser.write(tokens);
        }
        else if(delta && "reasoning_content" in delta && delta.reasoning_content) {
          if(reasoningContent == null) reasoningContent = "";
          reasoningContent += delta.reasoning_content;
          onTokens(delta.reasoning_content, "reasoning");
        }
        else if(delta && "tool_calls" in delta && delta.tool_calls && delta.tool_calls.length > 0) {
          for(const deltaCall of delta.tool_calls) {
            onTokens((deltaCall.function.name || "") + (deltaCall.function.arguments || ""), "tool");
            if(currTool == null) {
              currTool = {
                id: deltaCall.id,
                function: {
                  name: deltaCall.function.name || "",
                  arguments: deltaCall.function.arguments || "",
                },
              };
            }
            else {
              if(deltaCall.id && deltaCall.id !== currTool.id) {
                doneParsingTools = true;
                break;
              }
              if(deltaCall.function.name) currTool.function!.name = deltaCall.function.name;
              if(deltaCall.function.arguments) currTool.function!.arguments += deltaCall.function.arguments;
            }
          }
        }
      }
    } catch (e) {
      // Handle abort errors gracefully
      if (abortSignal.aborted) {
        // Fall through to return abbreviated response
      } else {
        throw e;
      }
    }

    // Make sure to close the parser to flush any remaining data
    xmlParser.close();

    // Calculate token usage delta from the previous total
    let tokenDelta = 0;
    if(usage.input !== 0 || usage.output !== 0) {
      trackTokens(model.model, "input", usage.input);
      trackTokens(model.model, "output", usage.output);
      if(!abortSignal.aborted) {
        const previousTokens = countIRTokens(windowedIR.ir);
        tokenDelta = (usage.input + usage.output) - previousTokens;
      }
    }

    const assistantIr: AssistantIR = {
      role: "assistant" as const,
      content, reasoningContent,
      tokenUsage: tokenDelta,
      outputTokens: usage.output,
    };

    // If aborted, don't try to parse tool calls - just return the assistant response
    if(abortSignal.aborted) return { success: true, output: [ assistantIr ], curl };

    // If no tool call, we're done
    if(currTool == null) return { success: true, output: [ assistantIr ], curl };

    // Got this far? Parse out the tool call
    const validatedTool = ResponseToolCallSchema.sliceResult(currTool);
    if(validatedTool instanceof t.Err) {
      const toolCallId = currTool["id"];
      if(toolCallId == null) throw new Error("Impossible tool call: no id given");
      return {
        success: true,
        curl,
        output: [
          assistantIr,
          {
            role: "tool-malformed",
            error: validatedTool.message,
            toolCallId,
            toolName: currTool.function?.name,
            arguments: currTool.function?.arguments,
          },
        ]
      };
    }

    const parseResult = await parseTool(validatedTool, toolDefs, autofixJson, abortSignal);

    if(parseResult.status === "error") {
      return {
        success: true,
        curl,
        output: [
          assistantIr,
          {
            role: "tool-malformed",
            error: parseResult.message,
            toolName: validatedTool.function.name,
            arguments: validatedTool.function.arguments,
            toolCallId: validatedTool.id,
          },
        ]
      };
    }

    assistantIr.toolCall = parseResult.tool;
    return { success: true, output: [ assistantIr ], curl };
  });
};

type ParseToolResult = {
  status: "success";
  tool: t.GetType<typeof ToolCallRequestSchema>,
} | {
  status: "error";
  message: string
};

async function parseTool(
  toolCall: ResponseToolCall,
  toolDefs: Record<string, ToolDef<any>>,
  autofixJson: (badJson: string, signal: AbortSignal) => Promise<JsonFixResponse>,
  abortSignal: AbortSignal,
): Promise<ParseToolResult> {
  const name = toolCall.function.name;
  const toolDef = toolDefs[name];

  if(!toolDef) {
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
  let [ err, args ] = tryexpr(() => {
    return toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
  });

  if(err) {
    const fixPromise = autofixJson(toolCall.function.arguments, abortSignal);
    const fixResponse = await fixPromise;
    if(!fixResponse.success) {
      return {
        status: "error",
        message: "Syntax error: invalid JSON in tool call arguments",
      };
    }
    args = fixResponse.fixed;
  }

  // Handle double-encoded arguments, which models sometimes produce
  if(typeof args === "string") {
    let [ err, argsParsed ] = tryexpr(() => {
      return toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
    });

    if(err) {
      const fixPromise = autofixJson(toolCall.function.arguments, abortSignal);
      const fixResponse = await fixPromise;
      if(!fixResponse.success) {
        return {
          status: "error",
          message: "Syntax error: invalid JSON in tool call arguments",
        };
      }
      args = fixResponse.fixed;
    }
    else {
      args = argsParsed;
    }
  }

  try {
    const parsed = toolSchema.slice({
      name: toolCall.function.name,
      arguments: args,
    });

    return {
      status: "success",
      tool: {
        type: "function",
        function: parsed,
        toolCallId: toolCall.id,
      },
    };
  } catch (e: unknown) {
    logger.error("verbose", e);
    logger.error("verbose", toolCall);
    const error = e instanceof Error ? e.message : "Invalid JSON in tool call";
    return {
      status: "error",
      message: `
Failed to parse tool call: ${error}. Make sure your JSON is valid and matches the expected format.
Your JSON was:
${JSON.stringify(toolCall.function)}
Expected:
${toTypescript(toolSchema)}

This is an error in your JSON formatting. You MUST try again, correcting this error. Think about
what the error is and fix it.
      `.trim(),
    };
  }
}
