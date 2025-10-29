import OpenAI from "openai";
import { t, toJSONSchema, toTypescript } from "structural";
import { Config, getModelFromConfig, assertKeyForModel } from "../config.ts";
import * as toolMap from "../tools/tool-defs/index.ts";
import { StreamingXMLParser, tagged } from "../xml.ts";
import { ToolCallRequestSchema } from "../history.ts";
import { systemPrompt } from "../system-prompt.ts";
import { LlmIR, OutputIR, AssistantMessage as AssistantIR } from "../ir/llm-ir.ts";
import { WindowedIR, countIRTokens } from "../ir/ir-windowing.ts";
import { fileTracker } from "../tools/file-tracker.ts";
import { autofixJson } from "../compilers/autofix.ts";
import { tryexpr } from "../tryexpr.ts";
import { trackTokens } from "../token-tracker.ts";
import * as logger from "../logger.ts";
import { PaymentError, RateLimitError } from "../errors.ts";
import { Transport } from "../transports/transport-common.ts";

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

async function toLlmMessages(
  messages: LlmIR[],
  appliedWindow: boolean,
  config: Config,
  transport: Transport,
  signal: AbortSignal,
  skipSystemPrompt?: boolean,
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
  if(!skipSystemPrompt) {
    output.unshift({
      role: "system",
      content: await systemPrompt({
        appliedWindow, config, transport, signal
      }),
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

async function handleKnownErrors<T>(cb: () => Promise<T>): Promise<T> {
  try {
    return await cb();
  } catch(e) {
    for(const [ ErrorClass, schema ] of ERROR_SCHEMAS) {
      const result = schema.sliceResult(e);
      if(!(result instanceof t.Err)) throw new ErrorClass(result.error);
    }
    throw e;
  }
}

export async function runAgent({
  config, modelOverride, windowedIR, onTokens, onAutofixJson, abortSignal, transport, skipSystemPrompt
}: {
  config: Config,
  modelOverride: string | null,
  windowedIR: WindowedIR,
  onTokens: (t: string, type: "reasoning" | "content" | "tool") => any,
  onAutofixJson: (done: Promise<void>) => any,
  abortSignal: AbortSignal,
  transport: Transport,
  skipSystemPrompt?: boolean,
}): Promise<OutputIR[]> {
  return await handleKnownErrors(async () => {
    const model = getModelFromConfig(config, modelOverride);
    const apiKey = await assertKeyForModel(model, config);
    const client = new OpenAI({
      baseURL: model.baseUrl,
      apiKey,
    });

    const messages = await toLlmMessages(
      windowedIR.ir,
      windowedIR.appliedWindow,
      config,
      transport,
      abortSignal,
      skipSystemPrompt,
    );

    const tools = Object.entries(toolMap).map(([ name, tool ]) => {
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

    let reasoning: {
      reasoning_effort?: "low" | "medium" | "high"
    } = {};
    if(model.reasoning) reasoning.reasoning_effort = model.reasoning;

    const res = await client.chat.completions.create({
      ...reasoning,
      model: model.model,
      messages,
      tools,
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
    if(abortSignal.aborted) return [ assistantIr ];

    // If no tool call, we're done
    if(currTool == null) return [ assistantIr ];

    // Got this far? Parse out the tool call
    const validatedTool = ResponseToolCallSchema.sliceResult(currTool);
    if(validatedTool instanceof t.Err) {
      const toolCallId = currTool["id"];
      if(toolCallId == null) throw new Error("Impossible tool call: no id given");
      return [
        assistantIr,
        {
          role: "tool-malformed",
          error: validatedTool.message,
          toolCallId,
          toolName: currTool.function?.name,
          arguments: currTool.function?.arguments,
        },
      ];
    }

    const parseResult = await parseTool(validatedTool, config, onAutofixJson, abortSignal);

    if(parseResult.status === "error") {
      return [
        assistantIr,
        {
          role: "tool-malformed",
          error: parseResult.message,
          toolName: validatedTool.function.name,
          arguments: validatedTool.function.arguments,
          toolCallId: validatedTool.id,
        },
      ];
    }

    assistantIr.toolCall = parseResult.tool;
    return [ assistantIr ];
  });
}

type ParseToolResult = {
  status: "success";
  tool: t.GetType<typeof ToolCallRequestSchema>,
} | {
  status: "error";
  message: string
};

const TOOL_NAMES = new Set(Object.keys(toolMap));
function hasMcp(config: Config) {
  if(config.mcpServers == null) return false;
  if(Object.keys(config.mcpServers).length === 0) return false;
  return true;
}

function isValidToolName(name: string, config: Config): name is ((keyof typeof toolMap) & string) {
  if(!hasMcp(config) && name === "mcp") return false;
  return TOOL_NAMES.has(name);
}

function validToolNames(config: Config) {
  return Object.keys(toolMap).filter(t => {
    if(hasMcp(config)) return true;
    return t !== "mcp";
  });
}

async function parseTool(
  toolCall: ResponseToolCall,
  config: Config,
  onAutofixJson: (done: Promise<void>) => any,
  abortSignal: AbortSignal,
): Promise<ParseToolResult> {
  const name = toolCall.function.name;
  if(!isValidToolName(name, config)) {
    return {
      status: "error",
      message: `
Unknown tool ${name}. The only valid tool names are:

- ${validToolNames(config).join("\n- ")}

Please try calling a valid tool.
      `.trim(),
    };
  }

  const toolSchema = toolMap[name].Schema;
  let [ err, args ] = tryexpr(() => {
    return toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
  });

  if(err) {
    const fixPromise = autofixJson(config, toolCall.function.arguments, abortSignal);
    onAutofixJson(fixPromise.then(() => {}));
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
      const fixPromise = autofixJson(config, toolCall.function.arguments, abortSignal);
      onAutofixJson(fixPromise.then(() => {}));
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
      `.trim(),
    };
  }
}
