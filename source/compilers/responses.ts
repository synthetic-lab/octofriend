import OpenAI from "openai";
import type {
  ResponseCreateParamsStreaming,
  ResponseInput,
  ResponseInputItem,
  ResponseStreamEvent,
  Tool,
} from "openai/resources/responses/responses";
import { t, toJSONSchema } from "structural";
import { Compiler } from "./compiler-interface.ts";
import {
  LlmIR,
  ToolCallRequest,
  MalformedRequest,
  AssistantMessage,
  ResponsesRequestDetails,
} from "../ir/llm-ir.ts";
import { ToolDef } from "../tools/common.ts";
import { tryexpr } from "../tryexpr.ts";
import { trackTokens } from "../token-tracker.ts";
import { sumAssistantTokens } from "../ir/count-ir-tokens.ts";
import * as logger from "../logger.ts";
import { errorToString } from "../errors.ts";
import { compactionCompilerExplanation } from "./autocompact.ts";
import { JsonFixResponse } from "../prompts/autofix-prompts.ts";
import * as irPrompts from "../prompts/ir-prompts.ts";
import { canDisplayImage, MultimodalConfig } from "../providers.ts";
import { APP_METADATA } from "../config.ts";
import { Transport } from "../transports/transport-common.ts";

type OpenAIProviderOptions = {
  itemId?: string;
  reasoningEncryptedContent?: string | null;
};

type TextContent = {
  type: "text";
  text: string;
};

type ImageContent = {
  type: "image";
  image: string;
};

type ReasoningContent = {
  type: "reasoning";
  text: string;
  providerOptions?: {
    openai?: OpenAIProviderOptions;
  };
};

type ToolCallContent = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: unknown;
};

type ToolResultContent = {
  type: "tool-result";
  toolName: string;
  toolCallId: string;
  output: {
    type: "text";
    value: string;
  };
};

type ModelMessageContent =
  | TextContent
  | ImageContent
  | ReasoningContent
  | ToolCallContent
  | ToolResultContent;

type ModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ModelMessageContent[];
  providerOptions?: {
    openai?: OpenAIProviderOptions;
  };
};

async function toModelMessage(
  messages: LlmIR[],
  systemPrompt?: () => Promise<string>,
  modalities?: MultimodalConfig,
): Promise<Array<ModelMessage>> {
  const output: ModelMessage[] = [];

  const irs = [...messages];
  irs.reverse();
  const seenPaths = new Set<string>();

  for (const ir of irs) {
    if (ir.role === "file-read") {
      let seen = seenPaths.has(ir.path);
      seenPaths.add(ir.path);
      output.push(modelMessageFromIr(ir, seen, modalities));
    } else {
      output.push(modelMessageFromIr(ir, false, modalities));
    }
  }

  output.reverse();

  if (systemPrompt) {
    const prompt = await systemPrompt();
    // Add system message
    output.unshift({
      role: "system",
      content: prompt,
    });
  }

  return output;
}

function modelMessageFromIr(
  ir: LlmIR,
  seenPath: boolean,
  modalities?: MultimodalConfig,
): ModelMessage {
  if (ir.role === "assistant") {
    if (ir.reasoningContent || ir.openai) {
      let openai = {};
      if (ir.openai) {
        openai = {
          itemId: ir.openai.reasoningId || "",
          reasoningEncryptedContent: ir.openai.encryptedReasoningContent,
        };
      }
      const toolCalls = ir.toolCalls || [];
      return {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: ir.reasoningContent || "",
            providerOptions: {
              openai: { ...openai },
            },
          },
          { type: "text", text: ir.content || " " },
          ...toolCalls.map(t => {
            return {
              type: "tool-call" as const,
              toolCallId: t.toolCallId,
              toolName: t.call.original.name,
              input: t.call.original.arguments || {},
            };
          }),
        ],
        providerOptions: {
          openai: {
            ...openai,
          },
        },
      };
    }
    const toolCalls = ir.toolCalls || [];
    return {
      role: "assistant",
      content: [
        { type: "text", text: ir.content || " " },
        ...toolCalls.map(t => {
          return {
            type: "tool-call" as const,
            toolCallId: t.toolCallId,
            toolName: t.call.original.name,
            input: t.call.original.arguments || {},
          };
        }),
      ],
      providerOptions: {
        openai: {},
      },
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
              type: "image" as const,
              image: img.dataUrl,
            })),
          ],
        };
      }
      return {
        role: "user",
        content: irPrompts.imageAttachmentPlaceholder(ir.content, ir.images),
      };
    }
    return {
      role: "user",
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
            type: "image" as const,
            image: ir.image.dataUrl,
          },
        ],
      };
    }
    return {
      role: "tool",
      content: [
        {
          type: "tool-result" as const,
          toolName: ir.toolCall.call.original.name,
          toolCallId: ir.toolCall.toolCallId,
          output: {
            type: "text" as const,
            value: irPrompts.fileRead(ir.content, seenPath, imageCheck),
          },
        },
      ],
    };
  }

  if (ir.role === "tool-output" || ir.role === "file-mutate") {
    let content: string;
    if (ir.role === "file-mutate") {
      content = irPrompts.fileMutation(ir.path);
    } else {
      content = ir.content;
    }

    return {
      role: "tool",
      content: [
        {
          type: "tool-result" as const,
          toolName: ir.toolCall.call.original.name,
          toolCallId: ir.toolCall.toolCallId,
          output: {
            type: "text" as const,
            value: content,
          },
        },
      ],
    };
  }

  if (ir.role === "tool-reject") {
    return {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolName: ir.toolCall.call.original.name,
          toolCallId: ir.toolCall.toolCallId,
          output: {
            type: "text" as const,
            value: irPrompts.toolReject(),
          },
        },
      ],
    };
  }

  if (ir.role === "tool-skip") {
    return {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolName: ir.toolCall.call.original.name,
          toolCallId: ir.toolCall.toolCallId,
          output: {
            type: "text" as const,
            value: irPrompts.toolSkip(ir.reason),
          },
        },
      ],
    };
  }

  if (ir.role === "tool-error") {
    return {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: ir.toolCall.toolCallId,
          toolName: ir.toolCall.call.original.name,
          output: {
            type: "text" as const,
            value: `Error: ${ir.error}`,
          },
        },
      ],
    };
  }

  if (ir.role === "tool-malformed") {
    return {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: ir.malformedRequest.toolCallId,
          toolName: ir.malformedRequest.call.original.name || "unknown",
          output: {
            type: "text" as const,
            value: `Error: ${ir.malformedRequest.error}`,
          },
        },
      ],
    };
  }

  if (ir.role === "tool-validation-error") {
    return {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: ir.toolCall.toolCallId,
          toolName: ir.toolCall.call.original.name,
          output: {
            type: "text" as const,
            value: `Error: ${ir.error}`,
          },
        },
      ],
    };
  }

  if (ir.role === "file-outdated") {
    return {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: ir.toolCall.toolCallId,
          toolName: ir.toolCall.call.original.name,
          output: {
            type: "text",
            value: ir.error,
          },
        },
      ],
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
    content: [
      {
        type: "tool-result",
        toolCallId: ir.toolCall.toolCallId,
        toolName: ir.toolCall.call.original.name,
        output: {
          type: "text",
          value: ir.error,
        },
      },
    ],
  };
}

function generateCurlFrom(params: {
  baseURL: string;
  responseParams: ResponseCreateParamsStreaming;
}): { type: "responses"; baseUrl: string; body: ResponseCreateParamsStreaming } {
  return { type: "responses", baseUrl: params.baseURL, body: params.responseParams };
}

function toResponseInput(messages: Array<ModelMessage>): Array<ResponseInputItem> {
  const inputs: Array<ResponseInputItem> = [];

  for (const message of messages) {
    if (message.role === "tool") {
      const content = Array.isArray(message.content) ? message.content : [];
      for (const part of content.filter(
        (part): part is ToolResultContent => part.type === "tool-result",
      )) {
        inputs.push({
          type: "function_call_output",
          call_id: part.toolCallId,
          output: part.output.value,
        });
      }
      continue;
    }

    if (message.role === "assistant") {
      if (!Array.isArray(message.content)) {
        inputs.push({ role: "assistant", content: message.content });
        continue;
      }

      const items: ResponseInputItem[] = [];
      const text = message.content
        .filter((part): part is TextContent => part.type === "text")
        .map(part => part.text)
        .join("");

      const reasoning = message.content.find(
        (part): part is ReasoningContent => part.type === "reasoning",
      );
      const openai = reasoning?.providerOptions?.openai || message.providerOptions?.openai;
      if (openai?.itemId) {
        items.push({
          type: "reasoning",
          id: openai.itemId,
          summary: [],
          encrypted_content: openai.reasoningEncryptedContent,
        });
      }

      if (text) items.push({ role: "assistant", content: text });

      for (const part of message.content.filter(
        (part): part is ToolCallContent => part.type === "tool-call",
      )) {
        items.push({
          type: "function_call",
          call_id: part.toolCallId,
          name: part.toolName,
          arguments: typeof part.input === "string" ? part.input : JSON.stringify(part.input ?? {}),
          status: "completed",
        });
      }

      inputs.push(...items);
      continue;
    }

    if (Array.isArray(message.content)) {
      inputs.push({
        role: message.role,
        content: message.content.map(part => {
          if (part.type === "image") {
            return {
              type: "input_image",
              image_url: part.image,
              detail: "auto",
            };
          }
          return {
            type: "input_text",
            text: part.type === "text" ? part.text : "",
          };
        }),
      });
      continue;
    }

    inputs.push({ role: message.role, content: message.content });
  }

  return inputs;
}

export const runResponsesAgent: Compiler = async ({
  model,
  apiKey,
  irs,
  onTokens,
  abortSignal,
  transport,
  systemPrompt,
  autofixJson,
  tools,
}) => {
  const messages = await toModelMessage(irs, systemPrompt, model.modalities);
  const input = toResponseInput(messages);

  // Convert tools to OpenAI Responses API format
  const toolDefs = tools || {};
  const openaiTools: Tool[] = Object.entries(toolDefs).map(([name, toolDef]) => {
    const argJsonSchema = toJSONSchema("ignore", toolDef.ArgumentsSchema);
    // Delete JSON schema fields unused by OpenAI function tools
    // @ts-ignore
    delete argJsonSchema.$schema;
    delete argJsonSchema.description;
    // @ts-ignore
    delete argJsonSchema.title;

    return {
      type: "function" as const,
      name,
      description: `The ${name} tool`,
      parameters: argJsonSchema,
      strict: null,
    };
  });

  const responseParams: ResponseCreateParamsStreaming = {
    model: model.model,
    input,
    stream: true,
    store: false,
    include: ["reasoning.encrypted_content"],
  };
  if (openaiTools.length > 0) {
    responseParams.tools = openaiTools;
  }
  if (model.reasoning) {
    responseParams.reasoning = {
      effort: model.reasoning,
      summary: "auto",
    };
  }

  const requestDetails: ResponsesRequestDetails = {
    type: "responses",
    baseUrl: model.baseUrl,
    body: responseParams,
  };

  try {
    const client = new OpenAI({
      baseURL: model.baseUrl,
      apiKey,
      defaultHeaders: {
        "User-Agent": `octofriend/${APP_METADATA.version}`,
      },
    });

    const result: AsyncIterable<ResponseStreamEvent> = await client.responses.create(
      responseParams,
      {
        signal: abortSignal,
      },
    );

    let content = "";
    let reasoningId: string | undefined = undefined;
    let reasoningContent: string | undefined = undefined;
    let usage = {
      input: 0,
      output: 0,
      reasoning: 0,
    };
    let encryptedReasoningContent: string | undefined = undefined;
    const toolCalls: Array<{ toolCallId: string; toolName: string; input: string }> = [];

    // Handle streaming chunks
    for await (const chunk of result) {
      if (abortSignal.aborted) break;

      switch (chunk.type) {
        case "response.output_text.delta":
          if (chunk.delta) {
            content += chunk.delta;
            onTokens(chunk.delta, "content");
          }
          break;

        case "response.reasoning_text.delta":
        case "response.reasoning_summary_text.delta":
          if (chunk.delta) {
            if (reasoningContent == null) reasoningContent = "";
            reasoningContent += chunk.delta;
            onTokens(chunk.delta, "reasoning");
          }
          break;

        case "response.reasoning_text.done":
        case "response.reasoning_summary_text.done":
          if (!reasoningContent && chunk.text) {
            reasoningContent = chunk.text;
          }
          break;

        case "response.output_item.done":
          if (chunk.item.type === "reasoning") {
            reasoningId = chunk.item.id;
            encryptedReasoningContent = chunk.item.encrypted_content || undefined;
          } else if (chunk.item.type === "function_call") {
            toolCalls.push({
              toolCallId: chunk.item.call_id,
              toolName: chunk.item.name,
              input: chunk.item.arguments,
            });
            onTokens(chunk.item.arguments, "tool");
          }
          break;

        case "response.completed":
          if (chunk.response.usage) {
            usage.input = chunk.response.usage.input_tokens || 0;
            usage.output = chunk.response.usage.output_tokens || 0;
            usage.reasoning = chunk.response.usage.output_tokens_details?.reasoning_tokens || 0;
          }
          break;
      }
    }

    // Track usage
    if (usage.input !== 0 || usage.output !== 0) {
      trackTokens(model.model, "input", usage.input);
      trackTokens(model.model, "output", usage.output);
      trackTokens(model.model, "output", usage.reasoning);
    }

    // Calculate token usage delta
    let tokenDelta = 0;
    if (usage.input !== 0 || usage.output !== 0) {
      if (!abortSignal.aborted) {
        const previousTokens = sumAssistantTokens(irs);
        tokenDelta = usage.input + usage.output + usage.reasoning - previousTokens;
      }
    }

    let openaiSpecific = {};
    if (reasoningId || encryptedReasoningContent) {
      openaiSpecific = { openai: { reasoningId, encryptedReasoningContent } };
    }
    const assistantHistoryItem: AssistantMessage = {
      role: "assistant",
      content,
      reasoningContent,
      ...openaiSpecific,
      tokenUsage: tokenDelta,
      outputTokens: usage.output,
    };

    // If aborted, don't try to parse tool calls
    if (abortSignal.aborted) {
      return { success: true, output: assistantHistoryItem, requestDetails };
    }

    if (toolCalls == null || toolCalls.length === 0) {
      return { success: true, output: assistantHistoryItem, requestDetails };
    }

    const parsedToolCalls: Array<ToolCallRequest | MalformedRequest> = [];

    for (const toolCall of toolCalls) {
      const chatToolCall = {
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        args: toolCall.input,
      };
      const parseResult = await parseTool(
        chatToolCall,
        toolDefs,
        autofixJson,
        abortSignal,
        transport,
      );

      if (parseResult.status === "error") {
        parsedToolCalls.push({
          type: "malformed-request",
          error: parseResult.message,
          call: {
            original: {
              name: toolCall.toolName,
              arguments: toolCall.input,
            },
          },
          toolCallId: toolCall.toolCallId,
        });
        continue;
      }

      parsedToolCalls.push(parseResult.tool);
    }

    if (parsedToolCalls.length > 0) assistantHistoryItem.toolCalls = parsedToolCalls;

    return { success: true, output: assistantHistoryItem, requestDetails };
  } catch (e) {
    return {
      success: false,
      requestError: errorToString(e),
      requestDetails,
    };
  }
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
  toolCall: { toolCallId: string; toolName: string; args: unknown },
  toolDefs: Record<string, ToolDef<any, any, any>>,
  autofixJson: (badJson: string, signal: AbortSignal) => Promise<JsonFixResponse>,
  abortSignal: AbortSignal,
  transport: Transport,
): Promise<ParseToolResult> {
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

  // If args is a string, try to parse as JSON
  if (typeof args === "string") {
    const rawArgs = args;
    let [err, parsedArgs] = tryexpr(() => {
      return JSON.parse(rawArgs);
    });

    if (err) {
      const fixPromise = autofixJson(rawArgs, abortSignal);
      const fixResponse = await fixPromise;
      if (!fixResponse.success) {
        return {
          status: "error",
          message: "Syntax error: invalid JSON in tool call arguments",
        };
      }
      args = fixResponse.fixed;
    } else {
      args = parsedArgs;
    }
  }

  try {
    const sliced = toolSchema.slice({
      name: toolCall.toolName,
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
      `.trim(),
    };
  }
}
