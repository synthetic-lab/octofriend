import Anthropic from "@anthropic-ai/sdk";
import { t, toJSONSchema } from "structural";
import { Config, getModelFromConfig } from "../config.ts";
import * as toolMap from "../tools/tool-defs/index.ts";
import {
  HistoryItem,
  ToolCallRequestSchema,
  sequenceId,
  AssistantItem,
  AnthropicAssistantData
} from "../history.ts";

const ThinkingBlockSchema = t.subtype({
  type: t.value("thinking"),
  thinking: t.str,
  signature: t.str,
});
import { systemPrompt } from "../system-prompt.ts";
import { toLlmIR, LlmIR } from "../ir/llm-ir.ts";
import { fileTracker } from "../tools/file-tracker.ts";
import { autofixJson } from './autofix.ts';
import { tryexpr } from "../tryexpr.ts";
import { trackTokens } from "../token-tracker.ts";
import { applyContextWindow, messageHistoryTokens } from "../windowing.ts";

async function toModelMessage(
  messages: HistoryItem[],
): Promise<Array<Anthropic.MessageParam>> {
  const output: Anthropic.MessageParam[] = [];

  const irs = toLlmIR(messages);
  irs.reverse();
  const seenPaths = new Set<string>();

  for(const ir of irs) {
    if(ir.role === "file-tool-output") {
      let seen = seenPaths.has(ir.path);
      seenPaths.add(ir.path);
      output.push(await modelMessageFromIr(ir, seen));
    } else {
      output.push(await modelMessageFromIr(ir, false));
    }
  }

  output.reverse();

  return output;
}

async function modelMessageFromIr(ir: LlmIR, seenPath: boolean): Promise<Anthropic.MessageParam> {
  if(ir.role === "assistant") {
    let thinkingBlocks = ir.anthropic?.thinkingBlocks || [];
    const toolCalls = ir.toolCall ? [ ir.toolCall ] : [];
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
          content = await fileTracker.read(ir.path);
        } catch {
          content = "Tool ran successfully.";
        }
      }
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
        }
      ],
    };
  }

  if(ir.role === "tool-reject") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: ir.toolCall.toolCallId,
          is_error: true,
          content: "Tool call rejected by user. Your tool call did not run.",
        }
      ],
    };
  }

  if(ir.role === "tool-error") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: ir.toolCallId,
          is_error: true,
          content: `Error: ${ir.error}`,
        }
      ],
    };
  }

  if(ir.role === "file-outdated") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: ir.toolCall.toolCallId,
          is_error: true,
          content: "File could not be updated because it was modified after being last read. The latest version of the file has been automatically re-read and placed in your context space. Please try again.",
        },
      ],
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
        content: `File ${ir.path} could not be read. Has it been deleted?`,
      }
    ],
  };
}

export async function runAnthropicAgent({
  config, modelOverride, history, onTokens, onAutofixJson, abortSignal
}: {
  config: Config,
  modelOverride: string | null,
  history: HistoryItem[],
  onTokens: (t: string, type: "reasoning" | "content") => any,
  onAutofixJson: (done: Promise<void>) => any,
  abortSignal: AbortSignal,
}) {
  const modelConfig = getModelFromConfig(config, modelOverride);
  const processedHistory = applyContextWindow(history, modelConfig.context);
  const messages = await toModelMessage(processedHistory.history);
  const sysPrompt = await systemPrompt({
    appliedWindow: processedHistory.appliedWindow,
    config,
    exampleToolCall: JSON.stringify({
      type: "tool_use",
      id: "SOME_STRING_ID",
      name: "bash",
      input: JSON.stringify({
        cmd: "curl \"https://github.com/reissbaker/antipattern\"",
        timeout: 10000,
      } satisfies t.GetType<typeof toolMap.bash.ArgumentsSchema>),
    }),
  });

  // Convert tools to AI SDK format
  const tools: Array<{ description: string, input_schema: any, name: string }> = [];
  Object.entries(toolMap).forEach(([name, toolDef]) => {
    const argJsonSchema = toJSONSchema("ignore", toolDef.ArgumentsSchema);
    // Delete JSON schema fields unused by AI SDK
    // @ts-ignore
    delete argJsonSchema.$schema;
    delete argJsonSchema.description;
    // @ts-ignore
    delete argJsonSchema.title;

    tools.push({
      name,
      description: `The ${name} tool`,
      input_schema: argJsonSchema,
    });
  });

  const client = new Anthropic({
    baseURL: modelConfig.baseUrl,
    apiKey: process.env[modelConfig.apiEnvVar],
  });

  const thinking: { thinking?: { type: "enabled", budget_tokens: number } }  = {
  };
  // TODO: allow this to be configurable
  if(modelConfig.reasoning) {
    thinking.thinking = {
      type: "enabled",
      budget_tokens: 8192,
    };
  }

  const result = await client.messages.create({
    system: sysPrompt,
    model: modelConfig.model,
    tools, messages,
    tool_choice: {
      type: "auto",
      disable_parallel_tool_use: true,
    },
    // TODO: allow this to be configurable. It's set to 32000 because that's Claude 4.1 Opus's max
    max_tokens: Math.min(32 * 1000 - (thinking.thinking?.budget_tokens || 0), modelConfig.context),
    ...thinking,
    stream: true,
  });

  let content = "";
  let reasoningContent: string | undefined = undefined;
  let usage = {
    input: 0,
    output: 0,
  };
  const thinkingBlocks: Array<{
    type: "thinking",
    thinking?: string,
    signature?: string,
    index: number,
  } | {
    type: "redacted_thinking",
    data: string,
  }> = [];
  let inProgressTool: {
    id: string,
    index: number,
    name: string,
    partialJson: string,
  } | undefined = undefined;

  // Handle streaming chunks
  for await (const chunk of result) {
    if (abortSignal.aborted) break;

    switch (chunk.type) {
      case "content_block_delta":
        switch(chunk.delta.type) {
          case "text_delta":
            content += chunk.delta.text;
            onTokens(chunk.delta.text, "content");
            break;
          case "thinking_delta":
            if(reasoningContent == null) reasoningContent = "";
            reasoningContent += chunk.delta.thinking;
            onTokens(chunk.delta.thinking, "reasoning");
            if(thinkingBlocks.length === 0) {
              thinkingBlocks.push({
                type: "thinking",
                thinking: chunk.delta.thinking,
                index: chunk.index,
              });
            }
            else {
              const lastBlock = thinkingBlocks[thinkingBlocks.length - 1];
              if(lastBlock.type === "thinking" && lastBlock.index === chunk.index) {
                lastBlock.thinking += chunk.delta.thinking;
              }
              else {
                thinkingBlocks.push({
                  type: "thinking",
                  thinking: chunk.delta.thinking,
                  index: chunk.index,
                });
              }
            }
            break;
          case "signature_delta":
            if(thinkingBlocks.length === 0) {
              thinkingBlocks.push({
                type: "thinking",
                signature: chunk.delta.signature,
                index: chunk.index,
              });
            }
            else {
              const lastBlock = thinkingBlocks[thinkingBlocks.length - 1];
              if(lastBlock.type === "thinking" && lastBlock.index === chunk.index) {
                lastBlock.signature = chunk.delta.signature;
              }
              else {
                thinkingBlocks.push({
                  type: "thinking",
                  signature: chunk.delta.signature,
                  index: chunk.index,
                });
              }
            }
            break;
          case "input_json_delta":
            if(inProgressTool != null && inProgressTool.index === chunk.index) {
              inProgressTool.partialJson += chunk.delta.partial_json;
            }
            break;
        }
        break;
      case "content_block_start":
        switch(chunk.content_block.type) {
          case "tool_use":
            if(inProgressTool == null) {
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
        if(chunk.usage.input_tokens && chunk.usage.input_tokens > 0) {
          usage.input = chunk.usage.input_tokens;
        }
        break;
      case "message_start":
        usage.input = chunk.message.usage.input_tokens;
        break;
    }
  }

  // Track usage
  if(usage.input !== 0 || usage.output !== 0) {
    trackTokens(modelConfig.model, "input", usage.input);
    trackTokens(modelConfig.model, "output", usage.output);
  }

  // Calculate token usage delta
  let tokenDelta = 0;
  if(usage.input !== 0 || usage.output !== 0) {
    if(!abortSignal.aborted) {
      const previousTokens = messageHistoryTokens(processedHistory.history);
      tokenDelta = (usage.input + usage.output) - previousTokens;
    }
  }

  let anthropic: { anthropic?: AnthropicAssistantData } = {};
  if(thinkingBlocks.length > 0) {
    anthropic.anthropic = {
      thinkingBlocks: thinkingBlocks.map(b => {
        if(b.type === "redacted_thinking") return b;
        return ThinkingBlockSchema.slice({
          type: "thinking",
          signature: b.signature || "",
          thinking: b.thinking || "",
        });
      }),
    };
  }

  const assistantHistoryItem: AssistantItem = {
    type: "assistant",
    id: sequenceId(),
    content, reasoningContent,
    ...anthropic,
    tokenUsage: tokenDelta,
  };

  // If aborted, don't try to parse tool calls
  if(abortSignal.aborted) return history.concat([assistantHistoryItem]);

  // Get tool calls
  if(inProgressTool != null) {
    const chatToolCall = {
      toolCallId: inProgressTool.id,
      toolName: inProgressTool.name,
      args: inProgressTool.partialJson,
    }
    const parseResult = await parseResponsesTool(
      chatToolCall,
      config,
      onAutofixJson
    );

    if(parseResult.status === "error") {
      return history.concat([
        assistantHistoryItem,
        {
          type: "tool-malformed",
          id: sequenceId(),
          error: parseResult.message,
          original: {
            id: inProgressTool.id,
            function: {
              name: inProgressTool.name,
              arguments: inProgressTool.partialJson,
            },
          },
          toolCallId: inProgressTool.id,
        },
      ]);
    }

    return history.concat([
      assistantHistoryItem,
      {
        type: "tool",
        id: sequenceId(),
        tool: parseResult.tool,
      },
    ]);
  }

  return history.concat([assistantHistoryItem]);
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
      const fixPromise = autofixJson(config, args);
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
    console.error(e);
    console.error(toolCall);
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
