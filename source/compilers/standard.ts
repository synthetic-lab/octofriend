import { t, toJSONSchema } from "structural";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { CompilerIR, CompilerParams, CompilerResult } from "./compiler-interface.ts";
import { parseToolCall } from "./parse-tool-call.ts";
import { StreamingXMLParser, tagged } from "../xml.ts";
import type {
  Agent,
  AssistantMessage as AssistantIR,
  Content as IRContent,
  MalformedToolRequest,
} from "../libocto/llm-ir.ts";
import type { LoadedTools, ToolCall } from "../libocto/tool-def.ts";
import { QuotaData } from "../utils/quota.ts";
import { parseQuotaJson } from "../utils/quota.ts";
import { sumAssistantTokens } from "../ir/count-ir-tokens.ts";
import { result } from "../result.ts";
import { trackTokens } from "../token-tracker.ts";
import { errorToString, PaymentError, RateLimitError } from "../errors.ts";
import * as irPrompts from "../prompts/ir-prompts.ts";
import type { MultimodalConfig } from "../providers.ts";
import { getDefaultOpenaiClient } from "./openai.ts";

type ToolCallRequest<A extends Agent<any, any, any>> = ToolCall<A["tools"]>;
type LoadedTool<A extends Agent<any, any, any>> = LoadedTools<A["tools"]>[keyof LoadedTools<
  A["tools"]
>];

type UserContent = Array<
  | { type: "text"; text: string }
  | {
      type: "image_url";
      image_url: {
        url: string;
      };
    }
>;
type UserMessage = {
  role: "user";
  content: UserContent;
};

type AssistantMessage = {
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

type ToolMessage = {
  role: "tool";
  content: UserContent;
  tool_call_id: string;
};

type SystemPrompt = {
  role: "system";
  content: string;
};

type LlmMessage = SystemPrompt | UserMessage | AssistantMessage | ToolMessage;

type ChatCompletionCompatibleMessage =
  | Exclude<ChatCompletionMessageParam, { role: "tool" }>
  | (Omit<Extract<ChatCompletionMessageParam, { role: "tool" }>, "content"> & {
      content: UserContent;
    });

const ResponseToolCallSchema = t.subtype({
  id: t.str,
  function: t.subtype({
    name: t.str,
    arguments: t.str,
  }),
});

type ResponseToolCall = t.GetType<typeof ResponseToolCallSchema>;

const TOOL_ERROR_TAG = "tool-runtime-error";

function imagePlaceholderContent(): string {
  return irPrompts.imageAttachmentPlaceholderText();
}

function openaiContentParts(
  content: IRContent["content"],
  modalities?: MultimodalConfig,
): UserContent {
  const output: UserContent = [];
  for (const part of content) {
    if (part.type === "text") {
      output.push({ type: "text", text: part.content });
      continue;
    }
    if (modalities?.image?.enabled) {
      output.push({
        type: "image_url",
        image_url: { url: part.image.dataUrl },
      });
    } else {
      output.push({ type: "text", text: imagePlaceholderContent() });
    }
  }
  return output;
}

function generateCurlFrom(params: {
  baseURL: string;
  model: string;
  messages: ChatCompletionMessageParam[];
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

async function toLlmMessages<A extends Agent<any, any, any>>(
  messages: Array<CompilerIR<A>>,
  systemPrompt?: () => Promise<string>,
  modalities?: MultimodalConfig,
): Promise<Array<ChatCompletionMessageParam>> {
  const output: LlmMessage[] = [];

  for (const ir of messages) {
    output.push(llmFromIr(ir, modalities));
  }

  if (systemPrompt) {
    const prompt = await systemPrompt();
    output.unshift({
      role: "system",
      content: prompt,
    });
  }

  return output as ChatCompletionCompatibleMessage[] as ChatCompletionMessageParam[];
}

function llmFromIr<A extends Agent<any, any, any>>(
  ir: CompilerIR<A>,
  modalities?: MultimodalConfig,
): LlmMessage {
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
      tool_calls: toolCalls
        .filter((t: any) => t.type === "tool-call")
        .map((tc: any) => {
          return {
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: tc.original ? JSON.stringify(tc.original) : "{}",
            },
            id: tc.toolCallId,
          };
        }),
    };
  }
  if (ir.role === "user") {
    return { role: "user", content: openaiContentParts(ir.content, modalities) };
  }

  if (ir.role === "tool-output") {
    return {
      role: "tool",
      tool_call_id: ir.toolCall.toolCallId,
      content: openaiContentParts(ir.content, modalities),
    };
  }

  if (ir.role === "tool-skip-output") {
    return {
      role: "tool",
      tool_call_id: ir.toolCall.toolCallId,
      content: [{ type: "text", text: tagged(TOOL_ERROR_TAG, {}, irPrompts.toolSkip(ir.reason)) }],
    };
  }

  if (ir.role === "tool-parse-error") {
    return {
      role: "tool",
      tool_call_id: ir.malformedRequest.toolCallId,
      content: [
        {
          type: "text",
          text: "Malformed tool call: " + tagged(TOOL_ERROR_TAG, {}, ir.malformedRequest.error),
        },
      ],
    };
  }

  if (ir.role === "tool-validation-error") {
    return {
      role: "tool",
      tool_call_id: ir.toolCall.toolCallId,
      content: [
        {
          type: "text",
          text: "Error from tool call validation: " + tagged(TOOL_ERROR_TAG, {}, ir.error),
        },
      ],
    };
  }

  if (ir.role === "tool-runtime-error") {
    return {
      role: "tool",
      tool_call_id: ir.toolCall.toolCallId,
      content: [{ type: "text", text: "Error: " + tagged(TOOL_ERROR_TAG, {}, ir.error) }],
    };
  }

  if (ir.role === "checkpoint") {
    return {
      role: "user",
      content: openaiContentParts(ir.content, modalities),
    };
  }

  throw new Error(`Unsupported IR role: ${(ir as any).role}`);
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

async function handleKnownErrors<A extends Agent<any, any, any>>(
  curl: string,
  cb: () => Promise<CompilerResult<A>>,
): Promise<CompilerResult<A>> {
  try {
    return await cb();
  } catch (e) {
    for (const [ErrorClass, schema] of ERROR_SCHEMAS) {
      const schemaResult = schema.sliceResult(e);
      if (!(schemaResult instanceof t.Err)) throw new ErrorClass(schemaResult.error);
    }
    // If schema is not found, generate request error with associated curl
    return result.err({
      requestError: errorToString(e),
      curl,
    });
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

export async function runAgent<A extends Agent<any, any, any>>({
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
}: CompilerParams<A>): Promise<CompilerResult<A>> {
  const messages = await toLlmMessages(irs, systemPrompt, model.modalities);

  const toolDefs = tools || {};
  const toolEntries = Object.entries(toolDefs) as Array<[string, LoadedTool<A>]>;
  const toolsMap = toolEntries.map(([name, tool]) => {
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
    toolEntries.length === 0
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
  return await handleKnownErrors(curl, async (): Promise<CompilerResult<A>> => {
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
          messages,
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

    const assistantIr: AssistantIR<A["tools"]> = {
      role: "assistant" as const,
      content,
      reasoningContent,
      tokenUsage: tokenDelta,
      outputTokens: usage.output,
    };

    // If aborted, don't try to parse tool calls - just return the assistant response
    if (abortSignal.aborted) return result.ok({ output: assistantIr, curl });

    // If no tool calls, we're done
    if (toolCallMap.size === 0) return result.ok({ output: assistantIr, curl });

    // Sort tool calls by their streaming index to preserve ordering
    const currTools = Array.from(toolCallMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([_, v]) => v);

    const toolCalls: Array<MalformedToolRequest | ToolCallRequest<A>> = [];

    for (const currTool of currTools) {
      const validatedTool = ResponseToolCallSchema.sliceResult(currTool);
      if (validatedTool instanceof t.Err) {
        const toolCallId = currTool["id"];
        if (toolCallId == null) throw new Error("Impossible tool call: no id given");
        toolCalls.push({
          type: "malformed-tool-request",
          error: validatedTool.message,
          call: {
            original: {
              name: currTool.function?.name || "unknown",
              arguments: currTool.function?.arguments || "",
            },
          },
          toolCallId,
        });
        continue;
      }

      const parseResult = await parseToolCall<A["tools"]>({
        toolCall: {
          toolCallId: validatedTool.id,
          toolName: validatedTool.function.name,
          args: validatedTool.function.arguments,
        },
        toolDefs,
        autofixJson,
        abortSignal,
        transport,
      });

      if (parseResult.status === "error") {
        toolCalls.push({
          type: "malformed-tool-request",
          error: parseResult.message,
          call: {
            original: {
              name: validatedTool.function.name,
              arguments: validatedTool.function.arguments,
            },
          },
          toolCallId: validatedTool.id,
        });
        continue;
      }

      toolCalls.push(parseResult.tool);
    }

    if (toolCalls.length > 0) assistantIr.toolCalls = toolCalls;

    return result.ok({ output: assistantIr, curl });
  });
}
