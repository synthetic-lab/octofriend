import { createOpenAI } from "@ai-sdk/openai";
import { streamText, tool, ModelMessage, jsonSchema, UserContent } from "ai";
import { t, toJSONSchema } from "structural";
import type { CompilerIR, CompilerParams, CompilerResult } from "./compiler-interface.ts";
import { parseToolCall } from "./parse-tool-call.ts";
import type {
  Agent,
  AssistantMessage,
  Content as IRContent,
  MalformedToolRequest,
} from "../libocto/llm-ir.ts";
import type { LoadedTools, ToolCall } from "../libocto/tool-def.ts";
import { trackTokens } from "../token-tracker.ts";
import { sumAssistantTokens } from "../ir/count-ir-tokens.ts";
import { result } from "../result.ts";
import { errorToString } from "../errors.ts";
import * as irPrompts from "../prompts/ir-prompts.ts";
import type { MultimodalConfig } from "../providers.ts";
import { APP_METADATA } from "../config.ts";

type ToolCallRequest<A extends Agent<any, any, any>> = ToolCall<A["tools"]>;
type LoadedTool<A extends Agent<any, any, any>> = LoadedTools<A["tools"]>[keyof LoadedTools<
  A["tools"]
>];
type ModelContentParts = Exclude<UserContent, string>;
type ToolContentOutputPart =
  | { type: "text"; text: string }
  | { type: "media"; data: string; mediaType: string };

function imagePlaceholderContent(): string {
  return irPrompts.imageAttachmentPlaceholderText();
}

function modelContentParts(
  content: IRContent["content"],
  modalities?: MultimodalConfig,
): ModelContentParts {
  const output: ModelContentParts = [];
  for (const part of content) {
    if (part.type === "text") {
      output.push({ type: "text", text: part.content });
      continue;
    }
    if (modalities?.image?.enabled) {
      output.push({ type: "image", image: part.image.dataUrl });
    } else {
      output.push({ type: "text", text: imagePlaceholderContent() });
    }
  }
  return output;
}

function toolContentOutput(content: IRContent["content"], modalities?: MultimodalConfig) {
  const value: ToolContentOutputPart[] = [];
  for (const part of content) {
    if (part.type === "text") {
      value.push({ type: "text", text: part.content });
      continue;
    }
    if (modalities?.image?.enabled) {
      value.push({
        type: "media",
        data: part.image.base64Data,
        mediaType: part.image.mimeType,
      });
    } else {
      value.push({ type: "text", text: imagePlaceholderContent() });
    }
  }

  return {
    type: "content" as const,
    value,
  };
}

async function toModelMessage<A extends Agent<any, any, any>>(
  messages: Array<CompilerIR<A>>,
  systemPrompt?: () => Promise<string>,
  modalities?: MultimodalConfig,
): Promise<Array<ModelMessage>> {
  const output: ModelMessage[] = [];

  for (const ir of messages) {
    output.push(modelMessageFromIr(ir, modalities));
  }

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

function modelMessageFromIr<A extends Agent<any, any, any>>(
  ir: CompilerIR<A>,
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
          ...toolCalls
            .filter((t: any) => t.type === "tool-call")
            .map((t: any) => {
              return {
                type: "tool-call" as const,
                toolCallId: t.toolCallId,
                toolName: t.name,
                input: t.original || {},
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
        ...toolCalls
          .filter((t: any) => t.type === "tool-call")
          .map((t: any) => {
            return {
              type: "tool-call" as const,
              toolCallId: t.toolCallId,
              toolName: t.name,
              input: t.original || {},
            };
          }),
      ],
      providerOptions: {
        openai: {},
      },
    };
  }

  if (ir.role === "user") {
    return {
      role: "user",
      content: modelContentParts(ir.content, modalities),
    };
  }

  if (ir.role === "tool-output") {
    return {
      role: "tool",
      content: [
        {
          type: "tool-result" as const,
          toolName: ir.toolCall.name,
          toolCallId: ir.toolCall.toolCallId,
          output: toolContentOutput(ir.content, modalities),
        },
      ],
    };
  }

  if (ir.role === "tool-skip-output") {
    return {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolName: ir.toolCall.name,
          toolCallId: ir.toolCall.toolCallId,
          output: {
            type: "text" as const,
            value: irPrompts.toolSkip(ir.reason),
          },
        },
      ],
    };
  }

  if (ir.role === "tool-runtime-error") {
    return {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: ir.toolCall.toolCallId,
          toolName: ir.toolCall.name,
          output: {
            type: "text" as const,
            value: `Error: ${ir.error}`,
          },
        },
      ],
    };
  }

  if (ir.role === "tool-parse-error") {
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
          toolName: ir.toolCall.name,
          output: {
            type: "text" as const,
            value: `Error: ${ir.error}`,
          },
        },
      ],
    };
  }

  if (ir.role === "checkpoint") {
    return {
      role: "user",
      content: modelContentParts(ir.content, modalities),
    };
  }

  throw new Error(`Unsupported IR role: ${(ir as any).role}`);
}

function generateCurlFrom(params: {
  baseURL: string;
  model: string;
  messages: Array<ModelMessage>;
  tools?: Record<string, any>;
}): string {
  const { baseURL, model, messages } = params;

  const requestBody = {
    model,
    input: messages,
    stream: true,
    store: false,
    include: ["reasoning.encrypted_content"],
  };

  return `curl -X POST '${baseURL}/responses' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer [REDACTED_API_KEY]' \\
  -d @- <<'JSON'
${JSON.stringify(requestBody)}
JSON`;
}

export async function runResponsesAgent<A extends Agent<any, any, any>>({
  model,
  apiKey,
  irs,
  onTokens,
  abortSignal,
  transport,
  systemPrompt,
  autofixJson,
  tools,
}: CompilerParams<A>): Promise<CompilerResult<A>> {
  const messages = await toModelMessage(irs, systemPrompt, model.modalities);

  // Convert tools to AI SDK format
  const toolDefs = tools || {};
  const toolsSdk: Record<string, any> = {};
  const toolEntries = Object.entries(toolDefs) as Array<[string, LoadedTool<A>]>;
  toolEntries.forEach(([name, toolDef]) => {
    const argJsonSchema = toJSONSchema("ignore", toolDef.ArgumentsSchema);
    // Delete JSON schema fields unused by AI SDK
    // @ts-ignore
    delete argJsonSchema.$schema;
    delete argJsonSchema.description;
    // @ts-ignore
    delete argJsonSchema.title;

    toolsSdk[name] = tool({
      description: toolDef.description,
      inputSchema: jsonSchema(argJsonSchema),
    });
  });
  const toolParams =
    toolEntries.length === 0
      ? {}
      : {
          tools: toolsSdk,
        };

  let reasoningConfig: {
    reasoningEffort?: "low" | "medium" | "high";
    reasoningSummary?: "auto";
  } = {};
  if (model.reasoning) {
    reasoningConfig.reasoningEffort = model.reasoning;
    reasoningConfig.reasoningSummary = "auto";
  }

  const curl = generateCurlFrom({
    baseURL: model.baseUrl,
    model: model.model,
    messages,
    ...toolParams,
  });

  try {
    const openai = createOpenAI({
      baseURL: model.baseUrl,
      apiKey,
      headers: {
        "User-Agent": `octofriend/${APP_METADATA.version}`,
      },
    });

    const stream = streamText({
      model: openai.responses(model.model),
      messages,
      ...toolParams,
      abortSignal,
      providerOptions: {
        openai: {
          ...reasoningConfig,
          store: false,
          include: ["reasoning.encrypted_content"],
        },
      },
    });

    let content = "";
    let reasoningId: string | undefined = undefined;
    let reasoningContent: string | undefined = undefined;
    let usage = {
      input: 0,
      output: 0,
      reasoning: 0,
    };
    let encryptedReasoningContent: string | undefined = undefined;

    // Handle streaming chunks
    for await (const chunk of stream.fullStream) {
      if (abortSignal.aborted) break;

      switch (chunk.type) {
        case "text-delta":
          if (chunk.text) {
            content += chunk.text;
            onTokens(chunk.text, "content");
          }
          break;

        case "reasoning-start":
          break;

        case "reasoning-delta":
          if (chunk.text) {
            if (reasoningContent == null) reasoningContent = "";
            reasoningContent += chunk.text;
            onTokens(chunk.text, "reasoning");
          }
          break;

        case "reasoning-end":
          const openai = chunk.providerMetadata ? chunk.providerMetadata["openai"] : {};
          const encrypted = openai["reasoningEncryptedContent"];
          if (encrypted && typeof encrypted === "string") {
            encryptedReasoningContent = encrypted;
          }
          const itemId = openai["itemId"];
          if (itemId && typeof itemId === "string") {
            reasoningId = itemId;
          }
          break;

        case "tool-call":
          // Tool call will be handled after streaming is complete; just let callers know the chunk
          // came through
          onTokens(`${chunk.input}`, "tool");
          break;

        case "finish":
          if (chunk.totalUsage) {
            usage.input = chunk.totalUsage.inputTokens || 0;
            usage.output = chunk.totalUsage.outputTokens || 0;
            usage.reasoning = chunk.totalUsage.reasoningTokens || 0;
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
    const assistantHistoryItem: AssistantMessage<A["tools"]> = {
      role: "assistant",
      content,
      reasoningContent,
      ...openaiSpecific,
      tokenUsage: tokenDelta,
      outputTokens: usage.output,
    };

    // If aborted, don't try to parse tool calls
    if (abortSignal.aborted) {
      return result.ok({ output: assistantHistoryItem, curl });
    }

    // Get tool calls
    const toolCalls = await stream.toolCalls;
    if (toolCalls == null || toolCalls.length === 0) {
      return result.ok({ output: assistantHistoryItem, curl });
    }

    const parsedToolCalls: Array<ToolCallRequest<A> | MalformedToolRequest> = [];

    for (const toolCall of toolCalls) {
      const chatToolCall = {
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        args: toolCall.input,
      };
      const parseResult = await parseToolCall<A["tools"]>({
        toolCall: chatToolCall,
        toolDefs,
        autofixJson,
        abortSignal,
        transport,
      });

      if (parseResult.status === "error") {
        parsedToolCalls.push({
          type: "malformed-tool-request",
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

    return result.ok({ output: assistantHistoryItem, curl });
  } catch (e) {
    return result.err({
      requestError: errorToString(e),
      curl,
    });
  }
}
