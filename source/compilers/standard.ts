import { t, toJSONSchema, toTypescript } from "structural";
import { Compiler } from "./compiler-interface.ts";
import { StreamingXMLParser, tagged } from "../xml.ts";
import {
  LlmIR,
  AssistantMessage as AssistantIR,
  AgentResult,
  ToolCallRequest,
  MalformedRequest,
  OutputIR,
} from "../ir/llm-ir.ts";
import { QuotaData } from "../utils/quota.ts";
import { parseQuotaJson } from "../utils/quota.ts";
import { sumAssistantTokens } from "../ir/count-ir-tokens.ts";
import { tryexpr } from "../tryexpr.ts";
import { trackTokens } from "../token-tracker.ts";
import * as logger from "../logger.ts";
import { errorToString, PaymentError, RateLimitError } from "../errors.ts";
import { compactionCompilerExplanation } from "./autocompact.ts";
import { ToolDef } from "../tools/common.ts";
import { JsonFixResponse } from "../prompts/autofix-prompts.ts";
import * as irPrompts from "../prompts/ir-prompts.ts";
import { canDisplayImage, MultimodalConfig } from "../providers.ts";
import { getDefaultOpenaiClient } from "./openai.ts";
import { Transport } from "../transports/transport-common.ts";

type Content =
  | string
  | Array<
      | { type: "text"; text: string }
      | {
          type: "image_url";
          image_url: {
            url: string;
          };
        }
    >;
export type UserMessage = {
  role: "user";
  content: Content;
};

export type AssistantMessage = {
  role: "assistant";
  content: string;
  tool_calls?: Array<{
    type: "function";
    function: {
      arguments: string;
      name: string;
    };
    id: string;
  }>;
};

export type ToolMessage = {
  role: "tool";
  content: string;
  tool_call_id: string;
};

export type SystemPrompt = {
  role: "system";
  content: string;
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
  systemPrompt?: () => Promise<string>,
  modalities?: MultimodalConfig,
): Promise<Array<LlmMessage>> {
  const output: LlmMessage[] = [];
  const irs = [...messages];

  irs.reverse();
  const seenPaths = new Set<string>();
  for (const ir of irs) {
    if (ir.role === "file-read") {
      let seen = seenPaths.has(ir.path);
      seenPaths.add(ir.path);
      output.push(llmFromIr(ir, seen, modalities));
    } else {
      output.push(llmFromIr(ir, false, modalities));
    }
  }

  output.reverse();
  if (systemPrompt) {
    const prompt = await systemPrompt();
    output.unshift({
      role: "system",
      content: prompt,
    });
  }

  return output;
}

function llmFromIr(ir: LlmIR, seenPath: boolean, modalities?: MultimodalConfig): LlmMessage {
  if (ir.role === "assistant") {
    const { toolCalls } = ir;
    const reasoning: { reasoning_content?: string } = {};
    if (ir.reasoningContent) reasoning.reasoning_content = ir.reasoningContent;

    if (toolCalls == null || toolCalls.length === 0) {
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
      tool_calls: toolCalls.map(tc => {
        return {
          type: "function" as const,
          function: {
            name: tc.call.original.name,
            arguments: tc.call.original.arguments
              ? JSON.stringify(tc.call.original.arguments)
              : "{}",
          },
          id: tc.toolCallId,
        };
      }),
    };
  }
  if (ir.role === "user") {
    if (ir.images && ir.images.length > 0) {
      if (modalities?.image?.enabled) {
        return {
          role: "user",
          content: [
            { type: "text", text: ir.content },
            ...ir.images.map(img => ({
              type: "image_url" as const,
              image_url: { url: img.dataUrl },
            })),
          ],
        };
      }
      return {
        role: "user",
        content: irPrompts.imageAttachmentPlaceholder(ir.content, ir.images),
      };
    }
    return { role: "user", content: ir.content };
  }

  if (ir.role === "tool-output") {
    return {
      role: "tool",
      tool_call_id: ir.toolCall.toolCallId,
      content: ir.content,
    };
  }

  if (ir.role === "file-read") {
    const imageCheck = ir.image ? canDisplayImage(modalities, ir.image) : null;
    if (ir.image && imageCheck?.ok) {
      return {
        role: "user",
        content: [
          { type: "text", text: `[Tool result for call ${ir.toolCall.toolCallId}]: ${ir.content}` },
          {
            type: "image_url",
            image_url: { url: ir.image.dataUrl },
          },
        ],
      };
    }
    return {
      role: "tool",
      tool_call_id: ir.toolCall.toolCallId,
      content: irPrompts.fileRead(ir.content, seenPath, imageCheck),
    };
  }

  if (ir.role === "file-mutate") {
    return {
      role: "tool",
      tool_call_id: ir.toolCall.toolCallId,
      content: irPrompts.fileMutation(ir.path),
    };
  }

  if (ir.role === "tool-reject") {
    return {
      role: "tool",
      tool_call_id: ir.toolCall.toolCallId,
      content: tagged(TOOL_ERROR_TAG, {}, irPrompts.toolReject()),
    };
  }

  if (ir.role === "tool-malformed") {
    return {
      role: "tool",
      tool_call_id: ir.toolCallId,
      content: "Malformed tool call: " + tagged(TOOL_ERROR_TAG, {}, ir.error),
    };
  }

  if (ir.role === "tool-error") {
    return {
      role: "tool",
      tool_call_id: ir.toolCall.toolCallId,
      content: "Error: " + tagged(TOOL_ERROR_TAG, {}, ir.error),
    };
  }

  if (ir.role === "file-outdated") {
    return {
      role: "tool",
      tool_call_id: ir.toolCall.toolCallId,
      content: `\n${tagged(TOOL_ERROR_TAG, {}, ir.error)}`,
    };
  }

  if (ir.role === "compaction-checkpoint") {
    return {
      role: "user",
      content: compactionCompilerExplanation(ir.summary),
    };
  }

  const _: "file-unreadable" = ir.role;

  return {
    role: "tool",
    tool_call_id: ir.toolCall.toolCallId,
    content: tagged(TOOL_ERROR_TAG, {}, ir.error),
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
  [PaymentError, PaymentErrorSchema] as const,
  [RateLimitError, RateLimitErrorSchema] as const,
];

async function handleKnownErrors(
  curl: string,
  cb: () => Promise<AgentResult>,
): Promise<AgentResult> {
  try {
    return await cb();
  } catch (e) {
    for (const [ErrorClass, schema] of ERROR_SCHEMAS) {
      const result = schema.sliceResult(e);
      if (!(result instanceof t.Err)) throw new ErrorClass(result.error);
    }
    // If schema is not found, generate request error with associated curl
    return {
      success: false,
      requestError: errorToString(e),
      curl,
    };
  }
}

function parseQuotaFromHeaders(headers: Headers): QuotaData | undefined {
  const raw = headers.get("x-synthetic-quotas");
  if (!raw) return undefined;
  try {
    return parseQuotaJson(raw);
  } catch {
    /* ignore errors, they're out-of-place in the menu */
    return undefined;
  }
}

export const runAgent: Compiler = async ({
  model,
  apiKey,
  irs,
  onTokens,
  onQuotaUpdated,
  abortSignal,
  transport,
  systemPrompt,
  autofixJson,
  tools,
}) => {
  const messages = await toLlmMessages(irs, systemPrompt, model.modalities);

  const toolDefs = tools || {};
  const toolsMap = Object.entries(toolDefs).map(([name, tool]) => {
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
  const toolsParam =
    Object.entries(toolDefs).length === 0
      ? {}
      : {
          tools: toolsMap,
        };

  const curl = generateCurlFrom({
    baseURL: model.baseUrl,
    model: model.model,
    messages,
    ...toolsParam,
  });
  return await handleKnownErrors(curl, async (): Promise<AgentResult> => {
    const client = getDefaultOpenaiClient({ baseUrl: model.baseUrl, apiKey });

    let reasoning: {
      reasoning_effort?: "low" | "medium" | "high";
    } = {};
    if (model.reasoning) reasoning.reasoning_effort = model.reasoning;

    const { data: res, response } = await client.chat.completions
      .create(
        {
          ...reasoning,
          model: model.model,
          messages: messages,
          ...toolsParam,
          stream: true,
          stream_options: {
            include_usage: true,
          },
        },
        {
          signal: abortSignal,
        },
      )
      .withResponse();

    const quota = parseQuotaFromHeaders(response.headers);
    if (quota) onQuotaUpdated?.(quota);

    let content = "";
    let reasoningContent: undefined | string = undefined;
    let inThinkTag = false;
    let usage = {
      input: 0,
      output: 0,
    };

    const xmlParser = new StreamingXMLParser({
      whitelist: ["think"],
      handlers: {
        onOpenTag: () => {
          if (content === "") inThinkTag = true;
        },

        onCloseTag: () => {
          inThinkTag = false;
        },

        onText: e => {
          if (inThinkTag) {
            if (reasoningContent == null) reasoningContent = "";
            reasoningContent += e.content;
            onTokens(e.content, "reasoning");
          } else {
            onTokens(e.content, "content");
            content += e.content;
          }
        },
      },
    });

    let toolCallMap = new Map<number, Partial<ResponseToolCall>>();

    try {
      for await (const chunk of res) {
        if (abortSignal.aborted) break;
        if (chunk.usage) {
          usage.input = chunk.usage.prompt_tokens;
          usage.output = chunk.usage.completion_tokens;
        }

        const delta = chunk.choices[0]?.delta as
          | {
              content: string;
            }
          | {
              reasoning_content: string;
            }
          | {
              tool_calls: Array<ResponseToolCall & { index?: number }>;
            }
          | {
              reasoning: string;
            }
          | null;

        if (delta && "content" in delta && delta.content) {
          const tokens = delta.content || "";
          xmlParser.write(tokens);
        } else if (delta && "reasoning_content" in delta && delta.reasoning_content) {
          if (reasoningContent == null) reasoningContent = "";
          reasoningContent += delta.reasoning_content;
          onTokens(delta.reasoning_content, "reasoning");
        } else if (delta && "reasoning" in delta && delta.reasoning) {
          if (reasoningContent == null) reasoningContent = "";
          reasoningContent += delta.reasoning;
          onTokens(delta.reasoning, "reasoning");
        } else if (
          delta &&
          "tool_calls" in delta &&
          delta.tool_calls &&
          delta.tool_calls.length > 0
        ) {
          for (const deltaCall of delta.tool_calls) {
            const index = deltaCall.index ?? 0;
            onTokens(
              (deltaCall.function.name || "") + (deltaCall.function.arguments || ""),
              "tool",
            );
            if (deltaCall.id) {
              toolCallMap.set(index, {
                id: deltaCall.id,
                function: {
                  name: deltaCall.function.name || "",
                  arguments: deltaCall.function.arguments || "",
                },
              });
            } else {
              const curr = toolCallMap.get(index);
              if (curr) {
                if (deltaCall.function.name) curr.function!.name = deltaCall.function.name;
                if (deltaCall.function.arguments)
                  curr.function!.arguments += deltaCall.function.arguments;
              }
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
    if (usage.input !== 0 || usage.output !== 0) {
      trackTokens(model.model, "input", usage.input);
      trackTokens(model.model, "output", usage.output);
      if (!abortSignal.aborted) {
        const previousTokens = sumAssistantTokens(irs);
        tokenDelta = usage.input + usage.output - previousTokens;
      }
    }

    const assistantIr: AssistantIR = {
      role: "assistant" as const,
      content,
      reasoningContent,
      tokenUsage: tokenDelta,
      outputTokens: usage.output,
    };

    // If aborted, don't try to parse tool calls - just return the assistant response
    if (abortSignal.aborted) return { success: true, output: [assistantIr], curl };

    // If no tool calls, we're done
    if (toolCallMap.size === 0) return { success: true, output: [assistantIr], curl };

    // Sort tool calls by their streaming index to preserve ordering
    const currTools = Array.from(toolCallMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([_, v]) => v);

    const toolCalls: Array<MalformedRequest | ToolCallRequest> = [];
    const malformedIrs: OutputIR[] = [];

    for (const currTool of currTools) {
      const validatedTool = ResponseToolCallSchema.sliceResult(currTool);
      if (validatedTool instanceof t.Err) {
        const toolCallId = currTool["id"];
        if (toolCallId == null) throw new Error("Impossible tool call: no id given");
        toolCalls.push({
          type: "malformed-request",
          call: {
            original: {
              name: currTool.function?.name || "unknown",
              arguments: currTool.function?.arguments || "",
            },
          },
          toolCallId,
        });
        malformedIrs.push({
          role: "tool-malformed",
          error: validatedTool.message,
          toolCallId,
          toolName: currTool.function?.name,
          arguments: currTool.function?.arguments,
        });
        continue;
      }

      const parseResult = await parseTool(
        validatedTool,
        toolDefs,
        autofixJson,
        abortSignal,
        transport,
      );

      if (parseResult.status === "error") {
        toolCalls.push({
          type: "malformed-request",
          call: {
            original: {
              name: validatedTool.function.name,
              arguments: validatedTool.function.arguments,
            },
          },
          toolCallId: validatedTool.id,
        });
        malformedIrs.push({
          role: "tool-malformed",
          error: parseResult.message,
          toolName: validatedTool.function.name,
          arguments: validatedTool.function.arguments,
          toolCallId: validatedTool.id,
        });
        continue;
      }

      toolCalls.push(parseResult.tool);
    }

    if (toolCalls.length > 0) {
      assistantIr.toolCalls = toolCalls;
    }

    if (malformedIrs.length > 0) {
      return {
        success: true,
        curl,
        output: [assistantIr, ...malformedIrs],
      };
    }

    return { success: true, output: [assistantIr], curl };
  });
};

type ParseToolResult =
  | {
      status: "success";
      tool: ToolCallRequest;
    }
  | {
      status: "error";
      message: string;
    };

async function parseTool(
  toolCall: ResponseToolCall,
  toolDefs: Record<string, ToolDef<any, any, any>>,
  autofixJson: (badJson: string, signal: AbortSignal) => Promise<JsonFixResponse>,
  abortSignal: AbortSignal,
  transport: Transport,
): Promise<ParseToolResult> {
  const name = toolCall.function.name;
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
  let [err, args] = tryexpr(() => {
    return toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
  });

  if (err) {
    const fixPromise = autofixJson(toolCall.function.arguments, abortSignal);
    const fixResponse = await fixPromise;
    if (!fixResponse.success) {
      return {
        status: "error",
        message: "Syntax error: invalid JSON in tool call arguments",
      };
    }
    args = fixResponse.fixed;
  }

  // Handle double-encoded arguments, which models sometimes produce
  if (typeof args === "string") {
    let [err, argsParsed] = tryexpr(() => {
      return toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
    });

    if (err) {
      const fixPromise = autofixJson(toolCall.function.arguments, abortSignal);
      const fixResponse = await fixPromise;
      if (!fixResponse.success) {
        return {
          status: "error",
          message: "Syntax error: invalid JSON in tool call arguments",
        };
      }
      args = fixResponse.fixed;
    } else {
      args = argsParsed;
    }
  }

  try {
    const sliced = toolSchema.slice({
      name: toolCall.function.name,
      arguments: args,
    });
    const parsed = await toolDef.parse(abortSignal, transport, sliced);
    if (parsed.success) {
      return {
        status: "success",
        tool: {
          type: "tool-request",
          call: parsed.data,
          toolCallId: toolCall.id,
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
