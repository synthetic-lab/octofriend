import OpenAI from "openai";
import { t, toJSONSchema } from "structural";
import { Config, getModelFromConfig } from "./config.ts";
import * as toolMap from "./tools/tool-defs/index.ts";
import { StreamingXMLParser, tagged } from "./xml.ts";
import { HistoryItem, ToolCallRequestSchema, sequenceId } from "./history.ts";
import { systemPrompt } from "./system-prompt.ts";
import { toLlmIR, LlmIR } from "./ir/llm-ir.ts";
import { fileTracker } from "./tools/file-tracker.ts";
import { fixEditPrompt, fixJsonPrompt, JsonFixResponse } from "./autofix-prompts.ts";
import { tryexpr } from "./tryexpr.ts";

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
  messages: HistoryItem[],
  appliedWindow: boolean,
  config: Config,
): Promise<Array<LlmMessage>> {
  const output: LlmMessage[] = [];

  const irs = toLlmIR(messages);
  irs.reverse();
  const seenPaths = new Set<string>();
  for(const ir of irs) {
    if(ir.role === "file-tool-output") {
      let seen = seenPaths.has(ir.path);
      seenPaths.add(ir.path);
      output.push(await llmFromIr(ir, seen));
    }
    else {
      output.push(await llmFromIr(ir, false));
    }
  }

  output.reverse();
  output.unshift({
    role: "system",
    content: await systemPrompt({
      appliedWindow,
      config,
      exampleToolCall: JSON.stringify({
        type: "function",
        id: "SOME_STRING_ID",
        function: {
          name: "bash",
          arguments: JSON.stringify({
            cmd: "curl \"https://github.com/reissbaker/antipattern\"",
            timeout: 10000,
          } satisfies t.GetType<typeof toolMap.bash.ArgumentsSchema>),
        },
      } satisfies ResponseToolCall & {
        type: "function",
      }),
    }),
  });

  return output;
}

async function llmFromIr(ir: LlmIR, seenPath: boolean): Promise<LlmMessage> {
  if(ir.role === "assistant") {
    const { toolCall } = ir;
    if(toolCall == null) {
      return {
        role: "assistant",
        content: ir.content || " ", // Some APIs don't like zero-length content strings
      };
    }
    return {
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
        content: await fileTracker.read(ir.path),
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
  if(ir.role === "tool-error") {
    return {
      role: "tool",
      tool_call_id: ir.toolCallId,
      content: tagged(TOOL_ERROR_TAG, {}, ir.error),
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

let totalTokensEver = 0;
export function totalTokensUsed() {
  return totalTokensEver;
}

type DiffEdit = t.GetType<typeof toolMap.edit.DiffEdit>;
export async function autofixEdit(config: Config, file: string, edit: DiffEdit) {
  const result = await autofix(config.diffApply, fixEditPrompt({ file, edit }));
  if(result == null) return null;
  try {
    const parsed = JSON.parse(result);
    if(parsed == null) return null;
    return toolMap.edit.DiffEdit.slice(parsed);
  } catch {
    return null;
  }
}

async function autofixJson(config: Config, brokenJson: string) {
  console.error("Fixing JSON...");
  const result = await autofix(config.fixJson, fixJsonPrompt(brokenJson));
  if(result == null) return { success: false as const };
  try {
    const json = JSON.parse(result);
    const response = JsonFixResponse.slice(json);
    if(response.success) return response;
    return { success: false as const };
  } catch {
    return { success: false as const };
  }
}

async function autofix(
  config: { baseUrl: string, apiEnvVar: string, model: string } | null | undefined,
  message: string
): Promise<string | null> {
  if(config == null) return null;

  const client = new OpenAI({
    baseURL: config.baseUrl,
    apiKey: process.env[config.apiEnvVar],
  });
  const response = await client.chat.completions.create({
    model: config.model,
    messages: [
      {
        role: "user",
        content: message,
      },
    ],
    response_format: {
      type: "json_object",
    },
  });

  if(response.usage) totalTokensEver += response.usage?.total_tokens;
  const result = response.choices[0].message.content;
  if(result == null) return null;
  return result;
}

export async function runAgent(
  client: OpenAI,
  config: Config,
  modelOverride: string | null,
  history: HistoryItem[],
  onTokens: (t: string, type: "reasoning" | "content") => any,
  abortSignal: AbortSignal,
) {
  const model = getModelFromConfig(config, modelOverride);

  const processedHistory = applyContextWindow(history, model.context);

  const messages = await toLlmMessages(
    processedHistory.history,
    processedHistory.appliedWindow,
    config
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
      strict: true,
      function: {
        name: name,
        description: `The ${name} tool`,
        parameters: argJsonSchema,
      },
    };
  });

  const res = await client.chat.completions.create({
    model: model.model,
    messages, tools,
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
  let usage = 0;

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
      // Check if aborted
      if (abortSignal.aborted) {
        break;
      }

      if(doneParsingTools) break;
      if(chunk.usage) usage = chunk.usage.total_tokens;

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
  totalTokensEver += usage;
  if(!abortSignal.aborted) {
    const previousTokens = messageHistoryTokens(processedHistory.history);
    tokenDelta = usage - previousTokens;
  }

  const assistantHistoryItem = {
    type: "assistant" as const,
    id: sequenceId(),
    content, reasoningContent,
    tokenUsage: tokenDelta,
  };

  // If aborted, don't try to parse tool calls - just return the assistant response
  if(abortSignal.aborted) return history.concat([ assistantHistoryItem ]);

  // Check if we found a tool call
  if (currTool) {
    const validatedTool = ResponseToolCallSchema.sliceResult(currTool);
    if(validatedTool instanceof t.Err) {
      const toolCallId = currTool["id"];
      if(toolCallId == null) throw new Error("Impossible tool call: no id given");
      return history.concat([
        assistantHistoryItem,
        {
          type: "tool-malformed",
          id: sequenceId(),
          error: validatedTool.message,
          original: currTool,
          toolCallId,
        },
      ]);
    }

    const parseResult = await parseTool(validatedTool, config);

    if(parseResult.status === "error") {
      return history.concat([
        assistantHistoryItem,
        {
          type: "tool-malformed",
          id: sequenceId(),
          error: parseResult.message,
          original: currTool,
          toolCallId: validatedTool.id,
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

  return history.concat([ assistantHistoryItem ]);
}

function messageHistoryTokens(history: HistoryItem[]) {
  let totalTokens = 0;
  for(const item of history) {
    if(item.type === "assistant") totalTokens += item.tokenUsage;
  }
  return totalTokens;
}

// Apply sliding window to keep context under token limit
function applyContextWindow(history: HistoryItem[], context: number): {
  appliedWindow: boolean,
  history: HistoryItem[],
} {
  const MAX_CONTEXT_TOKENS = Math.floor(context * 0.8);

  let totalTokens = messageHistoryTokens(history);
  if(totalTokens <= MAX_CONTEXT_TOKENS) return { appliedWindow: false, history };

  const windowedHistory: HistoryItem[] = [];
  let runningTokens = 0;

  // Work backwards from the end of history up to the budget
  for (let i = history.length - 1; i >= 0; i--) {
    const item = history[i];

    if (item.type === "assistant") {
      if (runningTokens + item.tokenUsage > MAX_CONTEXT_TOKENS) break;
      runningTokens += item.tokenUsage;
    }

    windowedHistory.unshift(item);
  }

  // If we couldn't fit any messages, throw an error
  if (windowedHistory.length === 0) {
    throw new Error("No history slice was small enough to fit in the context window budget");
  }

  return {
    appliedWindow: true,
    history: windowedHistory,
  };
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

async function parseTool(toolCall: ResponseToolCall, config: Config): Promise<ParseToolResult> {
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
    const fixResponse = await autofixJson(config, toolCall.function.arguments);
    if(!fixResponse.success) throw new Error("Invalid JSON in tool call arguments");
    args = fixResponse.fixed;
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
    console.error(e);
    console.error(toolCall);
    const error = e instanceof Error ? e.message : "Invalid JSON in tool call";
    return {
      status: "error",
      message: `
Failed to parse tool call: ${error}. Make sure your JSON is valid and matches the expected format.
      `.trim(),
    };
  }
}

