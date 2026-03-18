import { t, toJSONSchema, toTypescript } from "structural";
import { Compiler } from "./compiler-interface.ts";
import { StreamingXMLParser, tagged } from "../xml.ts";
import {
  LlmIR,
  AssistantMessage as AssistantIR,
  AgentResult,
  ToolCallRequest,
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
  let prev: LlmIR | null = null;
  for (const ir of irs) {
    if (ir.role === "file-read") {
      let seen = seenPaths.has(ir.path);
      seenPaths.add(ir.path);
      output.push(llmFromIr(ir, prev, seen, modalities));
    } else {
      output.push(llmFromIr(ir, prev, false, modalities));
    }
    prev = ir;
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

function llmFromIr(
  ir: LlmIR,
  prev: LlmIR | null,
  seenPath: boolean,
  modalities?: MultimodalConfig,
): LlmMessage {
  if (ir.role === "assistant") {
    const { toolCalls } = ir;
    const reasoning: { reasoning_content?: string } = {};
    if (ir.reasoningContent) reasoning.reasoning_content = ir.reasoningContent;

    if (!toolCalls || toolCalls.length === 0 || prev?.role === "tool-malformed") {
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
      tool_calls: toolCalls.map(tc => ({
        type: "function" as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments ? JSON.stringify(tc.function.arguments) : "{}",
        },
        id: tc.toolCallId,
      })),
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
      role: "user",
      content: "Malformed tool call: " + tagged(TOOL_ERROR_TAG, {}, ir.error),
    };
  }

  if (ir.role === "tool-error") {
    return {
      role: "tool",
      tool_call_id: ir.toolCallId,
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
  return await handleKnownErrors(curl, async () => {
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

    const currTools = new Map<string, Partial<ResponseToolCall>>();

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
              tool_calls: Array<ResponseToolCall>;
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
            // In OpenAI streaming format:
            // - First delta: has both `id` and `index`
            // - Subsequent deltas: only have `index` (for argument accumulation)
            // We need to handle both cases

            // Cast to any to access index property (not in our type definition but exists in API response)
            const toolIndex = (deltaCall as any).index;
            if (toolIndex === undefined) {
              logger.error("verbose", "Skipping tool call delta with no index:", deltaCall);
              continue;
            }

            onTokens(
              (deltaCall.function?.name || "") + (deltaCall.function?.arguments || ""),
              "tool",
            );

            // Use index as the key to find the tool call
            // We'll convert to use ID as key after streaming completes
            const indexKey = `index_${toolIndex}`;
            const existing = currTools.get(indexKey);

            if (!existing) {
              // First delta for this tool call - must have an ID
              if (!deltaCall.id) {
                logger.error(
                  "verbose",
                  "First delta for index",
                  toolIndex,
                  "missing ID:",
                  deltaCall,
                );
                continue;
              }
              currTools.set(indexKey, {
                id: deltaCall.id,
                function: {
                  name: deltaCall.function?.name || "",
                  arguments: deltaCall.function?.arguments || "",
                },
              });
            } else {
              // Subsequent delta - accumulate arguments
              if (deltaCall.id && deltaCall.id !== existing.id) {
                logger.error(
                  "verbose",
                  "ID mismatch at index",
                  toolIndex,
                  "expected:",
                  existing.id,
                  "got:",
                  deltaCall.id,
                );
              }
              if (deltaCall.function?.name) existing.function!.name = deltaCall.function.name;
              if (deltaCall.function?.arguments)
                existing.function!.arguments += deltaCall.function.arguments;
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
    if (currTools.size === 0) return { success: true, output: [assistantIr], curl };

    // Parse and validate all tool calls
    const toolResults: ToolCallRequest[] = [];
    const errors: Array<{
      toolCallId: string;
      toolName?: string;
      arguments?: string;
      error: string;
    }> = [];

    for (const [indexKey, tool] of currTools) {
      // The map key is "index_N" but the actual tool ID is in tool.id
      const toolId = tool.id;

      // Skip tools without IDs (should not happen if first delta had ID)
      if (!toolId) {
        logger.error("verbose", "Skipping tool without ID at", indexKey);
        continue;
      }

      logger.error("verbose", "Processing tool before normalization:", {
        indexKey,
        toolId,
        toolName: tool.function?.name,
        argumentsValue: tool.function?.arguments,
        argumentsType: typeof tool.function?.arguments,
        argumentsLength: tool.function?.arguments?.length,
      });

      // Normalize empty arguments to valid JSON
      if (tool.function && tool.function.arguments === "") {
        logger.error("verbose", "Normalizing empty arguments to {}");
        tool.function.arguments = "{}";
      }

      logger.error("verbose", "After normalization:", {
        argumentsValue: tool.function?.arguments,
      });

      const validatedTool = ResponseToolCallSchema.sliceResult(tool);
      if (validatedTool instanceof t.Err) {
        logger.error("verbose", "Tool validation failed:", {
          indexKey,
          toolId,
          tool,
          error: validatedTool.message,
        });
        errors.push({
          toolCallId: toolId,
          toolName: tool.function?.name,
          arguments: tool.function?.arguments,
          error: validatedTool.message,
        });
      } else {
        const parseResult = await parseTool(validatedTool, toolDefs, autofixJson, abortSignal);
        if (parseResult.status === "error") {
          errors.push({
            toolCallId: validatedTool.id,
            toolName: validatedTool.function.name,
            arguments: validatedTool.function.arguments,
            error: parseResult.message,
          });
        } else {
          toolResults.push(parseResult.tool);
        }
      }
    }

    // If we have successfully parsed tools, add them to the assistant message
    if (toolResults.length > 0) {
      assistantIr.toolCalls = toolResults;
    }

    // If there were any errors, return them as malformed tool messages
    if (errors.length > 0) {
      const errorMessages = errors.map(e => ({
        role: "tool-malformed" as const,
        toolCallId: e.toolCallId,
        toolName: e.toolName,
        arguments: e.arguments,
        error: e.error,
      }));
      return { success: true, curl, output: [assistantIr, ...errorMessages] };
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
  toolDefs: Record<string, ToolDef<any>>,
  autofixJson: (badJson: string, signal: AbortSignal) => Promise<JsonFixResponse>,
  abortSignal: AbortSignal,
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
