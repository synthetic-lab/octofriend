import Anthropic from "@anthropic-ai/sdk";
import { t, toJSONSchema } from "structural";
import { Compiler } from "./compiler-interface.ts";
import { countIRTokens } from "../ir/count-ir-tokens.ts";
import { AssistantMessage, LlmIR, ToolCallRequest, AnthropicAssistantData } from "../ir/llm-ir.ts";
import { getMimeTypeFromDataUrl, extractBase64FromDataUrl } from "../utils/image-utils.ts";
import * as logger from "../logger.ts";
import { tryexpr } from "../tryexpr.ts";
import { trackTokens } from "../token-tracker.ts";
import { errorToString } from "../errors.ts";
import { compactionCompilerExplanation } from "./autocompact.ts";
import { JsonFixResponse } from "../prompts/autofix-prompts.ts";
import * as irPrompts from "../prompts/ir-prompts.ts";

const ThinkingBlockSchema = t.subtype({
  type: t.value("thinking"),
  thinking: t.str,
  signature: t.str,
});

function toModelMessage(messages: LlmIR[]): Array<Anthropic.MessageParam> {
  const output: Anthropic.MessageParam[] = [];

  const irs = [...messages];
  irs.reverse();
  const seenPaths = new Set<string>();

  for (const ir of irs) {
    if (ir.role === "file-read") {
      let seen = seenPaths.has(ir.path);
      seenPaths.add(ir.path);
      output.push(modelMessageFromIr(ir, seen));
    } else {
      output.push(modelMessageFromIr(ir, false));
    }
  }

  output.reverse();

  return output;
}

function modelMessageFromIr(ir: LlmIR, seenPath: boolean): Anthropic.MessageParam {
  if (ir.role === "assistant") {
    let thinkingBlocks = ir.anthropic?.thinkingBlocks || [];
    const toolCalls = ir.toolCall ? [ir.toolCall] : [];
    return {
      role: "assistant",
      content: [
        ...thinkingBlocks,
        { type: "text", text: ir.content || " " },
        ...toolCalls.map(t => {
          return {
            type: "tool_use" as const,
            id: t.toolCallId,
            name: t.function.name,
            input: t.function.arguments || {},
          };
        }),
      ],
    };
  }

  if (ir.role === "user") {
    if (ir.images && ir.images.length > 0) {
      return {
        role: "user",
        content: [
          { type: "text", text: ir.content },
          ...ir.images.map(dataUrl => ({
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: getMimeTypeFromDataUrl(dataUrl) || "image/png",
              data: extractBase64FromDataUrl(dataUrl),
            },
          })),
        ],
      };
    }
    return {
      role: "user",
      content: ir.content,
    };
  }

  if (ir.role === "file-read") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: ir.toolCall.toolCallId,
          content: irPrompts.fileRead(ir.content, seenPath),
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
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: ir.toolCall.toolCallId,
          content,
        },
      ],
    };
  }

  if (ir.role === "tool-reject") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: ir.toolCall.toolCallId,
          is_error: true,
          content: irPrompts.toolReject(),
        },
      ],
    };
  }

  if (ir.role === "tool-error" || ir.role === "tool-malformed") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: ir.toolCallId,
          is_error: true,
          content: `Error: ${ir.error}`,
        },
      ],
    };
  }

  if (ir.role === "file-outdated") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: ir.toolCall.toolCallId,
          is_error: true,
          content: ir.error,
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

  // file-unreadable case
  const _: "file-unreadable" = ir.role;
  return {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: ir.toolCall.toolCallId,
        is_error: true,
        content: ir.error,
      },
    ],
  };
}

function generateCurlFrom(params: {
  baseURL: string;
  model: string;
  system: string;
  messages: Array<Anthropic.MessageParam>;
  tools?: Array<{ description: string; input_schema: any; name: string }>;
  maxTokens: number;
}): string {
  const { baseURL, model, system, messages, tools, maxTokens } = params;
  const requestBody = {
    model,
    system,
    messages,
    tools,
    tool_choice: {
      type: "auto",
      disable_parallel_tool_use: true,
    },
    max_tokens: maxTokens,
    stream: true,
  };

  // Curl requests need an API Version
  // Currently hardcoded in Anthropic SDK
  const ANTHROPIC_API_VERSION = "2023-06-01";

  return `curl -X POST "${baseURL}/v1/messages" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: [REDACTED_API_KEY]" \\
  -H "anthropic-version: ${ANTHROPIC_API_VERSION}" \\
  -d @- <<'JSON'
${JSON.stringify(requestBody)}
JSON`;
}

export const runAnthropicAgent: Compiler = async ({
  model,
  apiKey,
  irs,
  onTokens,
  abortSignal,
  systemPrompt,
  autofixJson,
  tools,
}) => {
  const messages = toModelMessage(irs);
  const sysPrompt = systemPrompt ? await systemPrompt() : "";

  const toolDefs = tools || {};
  const toolDefinitions: Array<{ description: string; input_schema: any; name: string }> = [];
  Object.entries(toolDefs).forEach(([name, toolDef]) => {
    const argJsonSchema = toJSONSchema("ignore", toolDef.ArgumentsSchema);
    // Delete JSON schema fields unused by AI SDK
    // @ts-ignore
    delete argJsonSchema.$schema;
    delete argJsonSchema.description;
    // @ts-ignore
    delete argJsonSchema.title;

    toolDefinitions.push({
      name,
      description: `The ${name} tool`,
      input_schema: argJsonSchema,
    });
  });
  const toolParams =
    toolDefinitions.length === 0
      ? {}
      : {
          tools: toolDefinitions,
        };

  const client = new Anthropic({
    baseURL: model.baseUrl,
    apiKey,
  });

  const thinking: { thinking?: { type: "enabled"; budget_tokens: number } } = {};
  if (model.reasoning) {
    thinking.thinking = {
      type: "enabled",
      budget_tokens: (() => {
        if (model.reasoning === "high") return 8192;
        if (model.reasoning === "medium") return 4096;
        return 2048;
      })(),
    };
  }

  // TODO: allow this to be configurable. It's set to 32000 because that's Claude 4.1 Opus's max
  const maxTokens = Math.min(32 * 1000 - (thinking.thinking?.budget_tokens || 0), model.context);

  const curl = generateCurlFrom({
    baseURL: model.baseUrl,
    model: model.model,
    system: sysPrompt,
    messages,
    ...toolParams,
    maxTokens,
  });

  try {
    const system = sysPrompt == null ? {} : { system: sysPrompt };
    const result = await client.messages.create({
      ...system,
      model: model.model,
      messages,
      ...toolParams,
      tool_choice: {
        type: "auto",
        disable_parallel_tool_use: true,
      },
      max_tokens: maxTokens,
      ...thinking,
      stream: true,
    });

    let content = "";
    let reasoningContent: string | undefined = undefined;
    let usage = {
      input: 0,
      output: 0,
    };
    const thinkingBlocks: Array<
      | {
          type: "thinking";
          thinking?: string;
          signature?: string;
          index: number;
        }
      | {
          type: "redacted_thinking";
          data: string;
        }
    > = [];
    let inProgressTool:
      | {
          id: string;
          index: number;
          name: string;
          partialJson: string;
        }
      | undefined = undefined;

    // Handle streaming chunks
    for await (const chunk of result) {
      if (abortSignal.aborted) break;

      switch (chunk.type) {
        case "content_block_delta":
          switch (chunk.delta.type) {
            case "text_delta":
              content += chunk.delta.text;
              onTokens(chunk.delta.text, "content");
              break;
            case "thinking_delta":
              if (reasoningContent == null) reasoningContent = "";
              reasoningContent += chunk.delta.thinking;
              onTokens(chunk.delta.thinking, "reasoning");
              if (thinkingBlocks.length === 0) {
                thinkingBlocks.push({
                  type: "thinking",
                  thinking: chunk.delta.thinking,
                  index: chunk.index,
                });
              } else {
                const lastBlock = thinkingBlocks[thinkingBlocks.length - 1];
                if (lastBlock.type === "thinking" && lastBlock.index === chunk.index) {
                  lastBlock.thinking += chunk.delta.thinking;
                } else {
                  thinkingBlocks.push({
                    type: "thinking",
                    thinking: chunk.delta.thinking,
                    index: chunk.index,
                  });
                }
              }
              break;
            case "signature_delta":
              if (thinkingBlocks.length === 0) {
                thinkingBlocks.push({
                  type: "thinking",
                  signature: chunk.delta.signature,
                  index: chunk.index,
                });
              } else {
                const lastBlock = thinkingBlocks[thinkingBlocks.length - 1];
                if (lastBlock.type === "thinking" && lastBlock.index === chunk.index) {
                  lastBlock.signature = chunk.delta.signature;
                } else {
                  thinkingBlocks.push({
                    type: "thinking",
                    signature: chunk.delta.signature,
                    index: chunk.index,
                  });
                }
              }
              break;
            case "input_json_delta":
              if (inProgressTool != null && inProgressTool.index === chunk.index) {
                onTokens(chunk.delta.partial_json, "tool");
                inProgressTool.partialJson += chunk.delta.partial_json;
              }
              break;
          }
          break;
        case "content_block_start":
          switch (chunk.content_block.type) {
            case "tool_use":
              onTokens(chunk.content_block.name, "tool");
              if (inProgressTool == null) {
                inProgressTool = {
                  id: chunk.content_block.id,
                  index: chunk.index,
                  name: chunk.content_block.name,
                  partialJson: "",
                };
              }
              break;
            case "redacted_thinking":
              thinkingBlocks.push({
                type: "redacted_thinking",
                data: chunk.content_block.data,
              });
              break;
          }
          break;

        case "message_delta":
          usage.output = chunk.usage.output_tokens;
          if (chunk.usage.input_tokens && chunk.usage.input_tokens > 0) {
            usage.input = chunk.usage.input_tokens;
          }
          break;
        case "message_start":
          usage.input = chunk.message.usage.input_tokens;
          break;
      }
    }

    // Track usage
    if (usage.input !== 0 || usage.output !== 0) {
      trackTokens(model.model, "input", usage.input);
      trackTokens(model.model, "output", usage.output);
    }

    // Calculate token usage delta
    let tokenDelta = 0;
    if (usage.input !== 0 || usage.output !== 0) {
      if (!abortSignal.aborted) {
        const previousTokens = countIRTokens(irs);
        tokenDelta = usage.input + usage.output - previousTokens;
      }
    }

    let anthropic: { anthropic?: AnthropicAssistantData } = {};
    if (thinkingBlocks.length > 0) {
      anthropic.anthropic = {
        thinkingBlocks: thinkingBlocks.map(b => {
          if (b.type === "redacted_thinking") return b;
          return ThinkingBlockSchema.slice({
            type: "thinking",
            signature: b.signature || "",
            thinking: b.thinking || "",
          });
        }),
      };
    }

    const assistantMessage: AssistantMessage = {
      role: "assistant",
      content,
      reasoningContent,
      ...anthropic,
      tokenUsage: tokenDelta,
      outputTokens: usage.output,
    };

    // If aborted, don't try to parse tool calls
    if (abortSignal.aborted) {
      // Success is only false when the request fails,
      // therefore success value is true here
      return { success: true, output: [assistantMessage], curl };
    }

    // No tools? Return
    if (inProgressTool == null) {
      return { success: true, output: [assistantMessage], curl };
    }

    // Get tool calls
    const chatToolCall = {
      toolCallId: inProgressTool.id,
      toolName: inProgressTool.name,
      args: inProgressTool.partialJson,
    };
    const parseResult = await parseTool(chatToolCall, toolDefs, autofixJson, abortSignal);

    if (parseResult.status === "error") {
      return {
        success: true,
        curl,
        output: [
          assistantMessage,
          {
            role: "tool-malformed",
            error: parseResult.message,
            toolName: inProgressTool.name,
            arguments: inProgressTool.partialJson,
            toolCallId: inProgressTool.id,
          },
        ],
      };
    }

    assistantMessage.toolCall = parseResult.tool;
    return { success: true, output: [assistantMessage], curl };
  } catch (e) {
    return {
      success: false,
      requestError: errorToString(e),
      curl,
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
  toolCall: { toolCallId: string; toolName: string; args: any },
  toolDefs: Record<string, any>,
  autofixJson: (badJson: string, signal: AbortSignal) => Promise<JsonFixResponse>,
  abortSignal: AbortSignal,
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
    let [err, parsedArgs] = tryexpr(() => {
      return JSON.parse(args);
    });

    if (err) {
      const fixPromise = autofixJson(args, abortSignal);
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
    const parsed = toolSchema.slice({
      name: toolCall.toolName,
      arguments: args,
    });

    return {
      status: "success",
      tool: {
        type: "function",
        function: parsed,
        toolCallId: toolCall.toolCallId,
      },
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
