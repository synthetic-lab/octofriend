import { createOpenAI } from '@ai-sdk/openai';
import { streamText, tool, ModelMessage, jsonSchema } from 'ai';
import { t, toJSONSchema } from "structural";
import { Config, getModelFromConfig, assertKeyForModel } from "../config.ts";
import * as toolMap from "../tools/tool-defs/index.ts";
import { ToolCallRequestSchema } from "../history.ts";
import { systemPrompt } from "../system-prompt.ts";
import { LlmIR, OutputIR, AssistantMessage, AgentResult } from "../ir/llm-ir.ts";
import { fileTracker } from "../tools/file-tracker.ts";
import { autofixJson } from './autofix.ts';
import { tryexpr } from "../tryexpr.ts";
import { trackTokens } from "../token-tracker.ts";
import { countIRTokens, WindowedIR } from "../ir/ir-windowing.ts";
import * as logger from "../logger.ts";
import { errorToString } from "../errors.ts";
import { Transport } from "../transports/transport-common.ts";

async function toModelMessage(
  transport: Transport,
  signal: AbortSignal,
  messages: LlmIR[],
  appliedWindow: boolean,
  config: Config,
  skipSystemPrompt: boolean,
): Promise<Array<ModelMessage>> {
  const output: ModelMessage[] = [];

  const irs = [ ...messages ];
  irs.reverse();
  const seenPaths = new Set<string>();

  for(const ir of irs) {
    if(ir.role === "file-tool-output") {
      let seen = seenPaths.has(ir.path);
      seenPaths.add(ir.path);
      output.push(await modelMessageFromIr(transport, signal, ir, seen));
    } else {
      output.push(await modelMessageFromIr(transport, signal, ir, false));
    }
  }

  output.reverse();

  if(!skipSystemPrompt) {
    // Add system message
    output.unshift({
      role: "system",
      content: await systemPrompt({
        appliedWindow,
        config, transport, signal,
      }),
    });
  }

  return output;
}

async function modelMessageFromIr(
  transport: Transport,
  signal: AbortSignal,
  ir: LlmIR,
  seenPath: boolean,
): Promise<ModelMessage> {
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

  if(ir.role === "tool-output" || ir.role === "file-tool-output") {
    let content: string;
    if(ir.role === "file-tool-output") {
      if(seenPath) {
        content = "Tool ran successfully.";
      } else {
        try {
          content = await fileTracker.read(transport, signal, ir.path);
        } catch {
          content = "Tool ran successfully.";
        }
      }
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
            value: "Tool call rejected by user. Your tool call did not run.",
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
            value: "File could not be updated because it was modified after being last read. The latest version of the file has been automatically re-read and placed in your context space. Please try again.",
          },
        },
      ],
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
          value: `File ${(ir as any).path} could not be read. Has it been deleted?`,
        },
      }
    ],
  };
}

// TODO: More specific headers needed
function generateCurlFrom(params: {
  baseURL: string;
  model: string;
  messages: Array<ModelMessage>;
  tools: Record<string, any>;
  reasoningConfig: {
    reasoningEffort?: "low" | "medium" | "high",
    reasoningSummary?: "auto",
  };
}): string {
  const { baseURL, model, messages, reasoningConfig } = params;

  const requestBody = {
    model,
    messages,
    stream: true,
    ...reasoningConfig,
    store: false,
    include: [ "reasoning.encrypted_content" ],
  };

  const jsonBody = JSON.stringify(requestBody)

  return `curl -X POST '${baseURL}/responses' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer [REDACTED_API_KEY]' \\
  -d '${jsonBody}'`;
}

export async function runResponsesAgent({
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
}): Promise<AgentResult> {
  const modelConfig = getModelFromConfig(config, modelOverride);
  const messages = await toModelMessage(
    transport,
    abortSignal,
    windowedIR.ir,
    windowedIR.appliedWindow,
    config,
    !!skipSystemPrompt,
  );

  // Convert tools to AI SDK format
  const tools: Record<string, any> = {};
  Object.entries(toolMap).forEach(([name, toolDef]) => {
    const argJsonSchema = toJSONSchema("ignore", toolDef.ArgumentsSchema);
    // Delete JSON schema fields unused by AI SDK
    // @ts-ignore
    delete argJsonSchema.$schema;
    delete argJsonSchema.description;
    // @ts-ignore
    delete argJsonSchema.title;

    tools[name] = tool({
      description: `The ${name} tool`,
      inputSchema: jsonSchema(argJsonSchema),
    });
  });

  let reasoningConfig: {
    reasoningEffort?: "low" | "medium" | "high",
    reasoningSummary?: "auto",
  } = {};
  if(modelConfig.reasoning) {
    reasoningConfig.reasoningEffort = modelConfig.reasoning;
    reasoningConfig.reasoningSummary = "auto";
  }

  try {
    const apiKey = await assertKeyForModel(modelConfig, config);
    const openai = createOpenAI({
      baseURL: modelConfig.baseUrl,
      apiKey,
    });

    const result = streamText({
      model: openai.responses(modelConfig.model),
      messages, tools,
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
      trackTokens(modelConfig.model, "input", usage.input);
      trackTokens(modelConfig.model, "output", usage.output);
      trackTokens(modelConfig.model, "output", usage.reasoning);
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
      return { success: true, output: [ assistantHistoryItem ] };
    }

    // Get tool calls
    const toolCalls = await result.toolCalls;
    if(toolCalls == null || toolCalls.length === 0) {
      return { success: true, output: [ assistantHistoryItem ] };
    }

    const firstToolCall = toolCalls[0];
    const chatToolCall = {
      toolCallId: firstToolCall.toolCallId,
      toolName: firstToolCall.toolName,
      args: firstToolCall.input,
    }
    const parseResult = await parseResponsesTool(
      chatToolCall,
      config,
      onAutofixJson,
      abortSignal,
    );

    if(parseResult.status === "error") {
      return {
        success: true,
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
    return { success: true, output: [ assistantHistoryItem ] };
  } catch (e) {
    const curl = generateCurlFrom({
      baseURL: modelConfig.baseUrl,
      model: modelConfig.model,
      messages,
      tools,
      reasoningConfig,
    });

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

async function parseResponsesTool(
  toolCall: { toolCallId: string; toolName: string; args: any },
  config: Config,
  onAutofixJson: (done: Promise<void>) => any,
  abortSignal: AbortSignal,
): Promise<ParseToolResult> {
  const name = toolCall.toolName;
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
  let args = toolCall.args;

  // If args is a string, try to parse as JSON
  if(typeof args === 'string') {
    let [ err, parsedArgs ] = tryexpr(() => {
      return JSON.parse(args);
    });

    if(err) {
      const fixPromise = autofixJson(config, args, abortSignal);
      onAutofixJson(fixPromise.then(() => {}));
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
