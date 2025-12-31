import { createOpenAI } from '@ai-sdk/openai';
import { streamText, tool, ModelMessage, jsonSchema } from 'ai';
import { t, toJSONSchema } from "structural";
import { Compiler } from './compiler-interface.ts';
import { LlmIR, ToolCallRequestSchema, AssistantMessage } from "../ir/llm-ir.ts";
import { tryexpr } from "../tryexpr.ts";
import { trackTokens } from "../token-tracker.ts";
import { countIRTokens } from "../ir/ir-windowing.ts";
import * as logger from "../logger.ts";
import { errorToString } from "../errors.ts";
import { compactionCompilerExplanation } from './autocompact.ts';
import { JsonFixResponse } from '../prompts/autofix-prompts.ts';
import * as irPrompts from "../prompts/ir-prompts.ts";

async function toModelMessage(
  messages: LlmIR[],
  systemPrompt?: () => Promise<string>,
): Promise<Array<ModelMessage>> {
  const output: ModelMessage[] = [];

  const irs = [ ...messages ];
  irs.reverse();
  const seenPaths = new Set<string>();

  for(const ir of irs) {
    if(ir.role === "file-read") {
      let seen = seenPaths.has(ir.path);
      seenPaths.add(ir.path);
      output.push(modelMessageFromIr(ir, seen));
    } else {
      output.push(modelMessageFromIr(ir, false));
    }
  }

  output.reverse();

  if(systemPrompt) {
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
): ModelMessage {
  if(ir.role === "assistant") {
    if(ir.reasoningContent || ir.openai) {
      let openai = {};
      if(ir.openai) {
        openai = {
          itemId: ir.openai.reasoningId || "",
          reasoningEncryptedContent: ir.openai.encryptedReasoningContent,
        };
      }
      const toolCalls = ir.toolCall ? [ ir.toolCall ] : [];
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
              toolName: t.function.name,
              input: t.function.arguments || {},
            };
          }),
        ],
        providerOptions: {
          openai: {
            ...openai,
          },
        }
      };
    }
    const toolCalls = ir.toolCall ? [ ir.toolCall ] : [];
    return {
      role: "assistant",
      content: [
        { type: "text", text: ir.content || " " },
        ...toolCalls.map(t => {
          return {
            type: "tool-call" as const,
            toolCallId: t.toolCallId,
            toolName: t.function.name,
            input: t.function.arguments || {},
          };
        }),
      ],
      providerOptions: {
        openai: {
        },
      }
    };
  }

  if(ir.role === "user") {
    return {
      role: "user",
      content: ir.content,
    };
  }

  if(ir.role === "file-read") {
    return {
      role: "tool",
      content: [
        {
          type: "tool-result" as const,
          toolName: ir.toolCall.function.name,
          toolCallId: ir.toolCall.toolCallId,
          output: {
            type: "text" as const,
            value: irPrompts.fileRead(ir.content, seenPath),
          },
        }
      ],
    };
  }

  if(ir.role === "tool-output" || ir.role === "file-mutate") {
    let content: string;
    if(ir.role === "file-mutate") {
      content = irPrompts.fileMutation(ir.path);
    } else {
      content = ir.content;
    }

    return {
      role: "tool",
      content: [
        {
          type: "tool-result" as const,
          toolName: ir.toolCall.function.name,
          toolCallId: ir.toolCall.toolCallId,
          output: {
            type: "text" as const,
            value: content,
          },
        }
      ],
    };
  }

  if(ir.role === "tool-reject") {
    return {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolName: ir.toolCall.function.name,
          toolCallId: ir.toolCall.toolCallId,
          output: {
            type: "text" as const,
            value: irPrompts.toolReject(),
          },
        }
      ],
    };
  }

  if(ir.role === "tool-error" || ir.role === "tool-malformed") {
    return {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: ir.toolCallId,
          toolName: ir.toolName || "unknown",
          output: {
            type: "text" as const,
            value: `Error: ${ir.error}`,
          },
        }
      ],
    };
  }

  if(ir.role === "file-outdated") {
    return {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: ir.toolCall.toolCallId,
          toolName: ir.toolCall.function.name,
          output: {
            type: "text",
            value: ir.error,
          },
        },
      ],
    };
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
    content: [
      {
        type: "tool-result",
        toolCallId: ir.toolCall.toolCallId,
        toolName: ir.toolCall.function.name,
        output: {
          type: "text",
          value: ir.error,
        },
      }
    ],
  };
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
    include: [ "reasoning.encrypted_content" ],
  };

  return `curl -X POST '${baseURL}/responses' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer [REDACTED_API_KEY]' \\
  -d @- <<'JSON'
${JSON.stringify(requestBody)}
JSON`;
}

export const runResponsesAgent: Compiler = async ({
  model, apiKey, windowedIR, onTokens, abortSignal, systemPrompt, autofixJson, tools
}) => {
  const messages = await toModelMessage(
    windowedIR.ir,
    systemPrompt,
  );

  // Convert tools to AI SDK format
  const toolDefs = tools || {};
  const toolsSdk: Record<string, any> = {};
  Object.entries(toolDefs).forEach(([name, toolDef]) => {
    const argJsonSchema = toJSONSchema("ignore", toolDef.ArgumentsSchema);
    // Delete JSON schema fields unused by AI SDK
    // @ts-ignore
    delete argJsonSchema.$schema;
    delete argJsonSchema.description;
    // @ts-ignore
    delete argJsonSchema.title;

    toolsSdk[name] = tool({
      description: `The ${name} tool`,
      inputSchema: jsonSchema(argJsonSchema),
    });
  });
  const toolParams = Object.entries(toolDefs).length === 0 ? {} : {
    tools: toolsSdk,
  };

  let reasoningConfig: {
    reasoningEffort?: "low" | "medium" | "high",
    reasoningSummary?: "auto",
  } = {};
  if(model.reasoning) {
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
    });

    const result = streamText({
      model: openai.responses(model.model),
      messages,
      ...toolParams,
      abortSignal,
      providerOptions: {
        openai: {
          ...reasoningConfig,
          store: false,
          include: [ "reasoning.encrypted_content" ],
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
    for await (const chunk of result.fullStream) {
      if (abortSignal.aborted) break;

      switch (chunk.type) {
        case 'text-delta':
          if (chunk.text) {
            content += chunk.text;
            onTokens(chunk.text, "content");
          }
          break;

        case 'reasoning-start':
          break;

        case 'reasoning-delta':
          if(chunk.text) {
            if (reasoningContent == null) reasoningContent = "";
            reasoningContent += chunk.text;
            onTokens(chunk.text, "reasoning");
          }
          break;

        case "reasoning-end":
          const openai = chunk.providerMetadata ? chunk.providerMetadata["openai"] : {};
          const encrypted = openai["reasoningEncryptedContent"];
          if(encrypted && typeof encrypted === "string") {
            encryptedReasoningContent = encrypted;
          }
          const itemId = openai["itemId"];
          if(itemId && typeof itemId === "string") {
            reasoningId = itemId;
          }
          break;

        case 'tool-call':
          // Tool call will be handled after streaming is complete; just let callers know the chunk
          // came through
          onTokens(`${chunk.input}`, "tool");
          break;

        case 'finish':
          if (chunk.totalUsage) {
            usage.input = chunk.totalUsage.inputTokens || 0;
            usage.output = chunk.totalUsage.outputTokens || 0;
            usage.reasoning = chunk.totalUsage.reasoningTokens || 0;
          }
          break;
      }
    }

    // Track usage
    if(usage.input !== 0 || usage.output !== 0) {
      trackTokens(model.model, "input", usage.input);
      trackTokens(model.model, "output", usage.output);
      trackTokens(model.model, "output", usage.reasoning);
    }

    // Calculate token usage delta
    let tokenDelta = 0;
    if(usage.input !== 0 || usage.output !== 0) {
      if(!abortSignal.aborted) {
        const previousTokens = countIRTokens(windowedIR.ir);
        tokenDelta = (usage.input + usage.output + usage.reasoning) - previousTokens;
      }
    }

    let openaiSpecific = {};
    if(reasoningId || encryptedReasoningContent) {
      openaiSpecific = { openai: { reasoningId, encryptedReasoningContent } };
    }
    const assistantHistoryItem: AssistantMessage = {
      role: "assistant",
      content, reasoningContent,
      ...openaiSpecific,
      tokenUsage: tokenDelta,
      outputTokens: usage.output,
    };

    // If aborted, don't try to parse tool calls
    if(abortSignal.aborted) {
      return { success: true, output: [ assistantHistoryItem ], curl };
    }

    // Get tool calls
    const toolCalls = await result.toolCalls;
    if(toolCalls == null || toolCalls.length === 0) {
      return { success: true, output: [ assistantHistoryItem ], curl };
    }

    const firstToolCall = toolCalls[0];
    const chatToolCall = {
      toolCallId: firstToolCall.toolCallId,
      toolName: firstToolCall.toolName,
      args: firstToolCall.input,
    }
    const parseResult = await parseTool(
      chatToolCall,
      toolDefs,
      autofixJson,
      abortSignal,
    );

    if(parseResult.status === "error") {
      return {
        success: true,
        curl,
        output: [
          assistantHistoryItem,
          {
            role: "tool-malformed",
            error: parseResult.message,
            toolName: firstToolCall.toolName,
            arguments: JSON.stringify(firstToolCall.input),
            toolCallId: firstToolCall.toolCallId,
          },
        ]
      };
    }

    assistantHistoryItem.toolCall = parseResult.tool;
    return { success: true, output: [ assistantHistoryItem ], curl };
  } catch (e) {
    return {
      success: false,
      requestError: errorToString(e),
      curl,
    };
  }
}

type ParseToolResult = {
  status: "success";
  tool: t.GetType<typeof ToolCallRequestSchema>,
} | {
  status: "error";
  message: string
};

async function parseTool(
  toolCall: { toolCallId: string; toolName: string; args: any },
  toolDefs: Record<string, any>,
  autofixJson: (badJson: string, signal: AbortSignal) => Promise<JsonFixResponse>,
  abortSignal: AbortSignal,
): Promise<ParseToolResult> {
  const name = toolCall.toolName;
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
  let args = toolCall.args;

  // If args is a string, try to parse as JSON
  if(typeof args === 'string') {
    let [ err, parsedArgs ] = tryexpr(() => {
      return JSON.parse(args);
    });

    if(err) {
      const fixPromise = autofixJson(args, abortSignal);
      const fixResponse = await fixPromise;
      if(!fixResponse.success) {
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
