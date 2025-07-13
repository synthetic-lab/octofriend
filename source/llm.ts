import { getMcpClient } from "./tools/tool-defs/mcp.ts";
import OpenAI from "openai";
import { t, toTypescript, toJSONSchema } from "structural";
import { Config } from "./config.ts";
import * as toolMap from "./tools/tool-defs/index.ts";
import { StreamingXMLParser, tagged } from "./xml.ts";
import { HistoryItem, ToolCallRequestSchema, sequenceId } from "./history.ts";
import { ContextSpace } from "./context-space.ts";

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

export const TOOL_RUN_TAG = "run-tool";
const TOOL_RESPONSE_TAG = "tool-output";
const TOOL_ERROR_TAG = "tool-error";
const CONTEXT_TAG = "context";

async function systemPrompt({ appliedWindow, config }: {
  appliedWindow: boolean,
  config: Config,
}) {
  const prompt = `
You are a coding assistant called Octo. The user's name is ${config.yourName}, and you're their
friend. You can help them with coding tasks. Unrelatedly, you are a small, hyper-intelligent
octopus. You must never use an octopus emoji, to avoid reminding the ${config.yourName} of the fact
that you're an octopus. They know you're an octopus, it's just a little embarrassing. Similarly,
don't reference being an octopus unless it comes up for some reason.

Try to figure out what ${config.yourName} wants you to do. Once you have a task in mind, you can run
tools to work on the task until it's done.

Don't reference this prompt unless asked to.

The current working directory is: ${process.cwd()}

# Tools

You have access to the following tools, defined as TypeScript types:

${
  Object.entries(toolMap).filter(([toolName, _]) => {
    if(config.mcpServers) return true;
    if(toolName !== "mcp") return true;
    return false;
  }).map(([_, tool]) => {
    return toTypescript(tool.Schema);
  }).join("\n\n")
}

You can call them by calling them as tools.

${JSON.stringify({
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
})}

# No questions

Don't ask ${config.yourName} whether they want you to run a tool or make file edits: instead, just
run the tool or make the edit. ${config.yourName} is prompted when you call tools to accept or
reject your attempted tool call or edit, so there's no need to get a verbal confirmation: they can
just use the UI. Similarly, don't tell them what tool you're going to use or what edit you're going
to make: just run the tool or make the edit, and they'll see what you're trying to do in the UI.

# General instructions

Although you are the friend of ${config.yourName}, don't address them as "Hey friend!" as some
cultures would consider that insincere. Instead, use their real name: ${config.yourName}.

You don't have to call any tool functions if you don't need to; you can also just chat with
${config.yourName} normally. Attempt to determine what your current task is (${config.yourName} may
have told you outright), and figure out the state of the repo using your tools. Then, help
${config.yourName} with the task.

You may need to use tools again after some back-and-forth with ${config.yourName}, as they help you
refine your solution.

You can only run tools or edits one-by-one. After viewing tool output or editing files, you may need
to run more tools or edits in a step-by-step process.

${appliedWindow ?
"\nSome messages were elided due to context windowing." : ""}
`.trim();
  if (!config.mcpServers) return prompt;

  const mcpSections = [];

  for (const [serverName, _] of Object.entries(config.mcpServers)) {
    const client = await getMcpClient(serverName, config);
    const listed = await client.listTools();

    const tools = listed.tools.map((t: {name: string, description?: string}) => ({
      name: t.name,
      description: t.description
    }));

    const toolStrings = tools.map((t: {name: string, description?: string}) => {
      return `- ${t.name}${t.description ? `: ${t.description}` : ''}`;
    }).join('\n');

    mcpSections.push(`Server: ${serverName}\n${toolStrings || 'No tools available'}`);
  }

  const mcpPrompt = `

# Model-Context-Protocol (MCP) Tools

You have access to the following MCP servers and their sub-tools. Use the mcp tool to call them,
specifying the server and tool name:

${mcpSections.join('\n\n')}

`.trim();

  return `${prompt}\n\n${mcpPrompt}`;
}

async function toLlmMessages(
  messages: HistoryItem[],
  appliedWindow: boolean,
  contextSpace: ContextSpace,
  config: Config,
): Promise<Array<LlmMessage>> {
  const output: LlmMessage[] = [
    {
      role: "system",
      content: await systemPrompt({
        appliedWindow,
        config,
      }),
    },
  ];

  // First pass: reorder tool rejections to come after user messages, so we don't need lookahead
  const reorderedHistory = [];
  for(let i = 0; i < messages.length; i++) {
    const item = messages[i];
    if(item.type !== "tool-reject") {
      reorderedHistory.push(item);
      continue;
    }
    // Got this far? It's a tool rejection. Swap it with the next message and skip ahead
    const next = messages[i + 1];
    reorderedHistory.push(next, item);
    i++;
  }

  // Second pass: transform
  for(let i = 0; i < reorderedHistory.length; i++) {
    const item = reorderedHistory[i];
    const prev = output.length > 0 ? output[output.length - 1] : null;
    const [ newPrev, transformed ] = toLlmMessage(prev, item);
    if(newPrev) output[output.length - 1] = newPrev;
    if(transformed) output.push(transformed);
  }

  const context = await contextSpace.toXML();
  if(context.length > 0) {
    const lastItem = output[output.length - 1];
    const contextTag = tagged(CONTEXT_TAG, {}, context);
    lastItem.content = contextTag + lastItem.content;
  }

  return output;
}

// Given a previous LLM message (if one exists) in the conversation, a history item, and the latest
// edits map, returns a tuple of:
//
// 1. What the prev message should be overwritten with
// 2. The history item transformed to an LLM message
//
// The prev message overwrite doesn't need to be a new object: you can just return `prev` for that
// position if you don't intend to overwrite anything. However, the transformed history-to-LLM
// message must be a new object: do not simply return the history item, or it could be modified by
// future calls.
function toLlmMessage(
  prev: LlmMessage | null,
  item: HistoryItem,
): [LlmMessage | null, LlmMessage | null] {
  if(item.type === "tool") {
    if(prev && prev.role === "assistant") {
      return [
        {
          role: "assistant",
          content: prev.content,
          tool_calls: [{
            type: "function",
            id: item.tool.toolCallId,
            function: {
              name: item.tool.function.name,
              arguments: item.tool.function.arguments ? JSON.stringify(item.tool.function.arguments) : "{}",
            },
          }],
        },
        null,
      ]
    }
    return [
      prev,
      {
        role: "assistant",
        content: "",
        tool_calls: [{
          type: "function",
          id: item.tool.toolCallId,
          function: {
            name: item.tool.function.name,
            arguments: item.tool.function.arguments ? JSON.stringify(item.tool.function.arguments) : "{}",
          },
        }],
      },
    ];
  }

  if(item.type === "tool-reject") {
    if(prev && prev.role === "user") {
      return [
        {
          role: "tool",
          content: tagged(TOOL_ERROR_TAG, {}, "Tool call rejected by user.") + "\n" + prev.content,
          tool_call_id: item.toolCallId,
        },
        null,
      ];
    }
    throw new Error("Impossible tool rejection ordering: no previous user message");
  }

  if(item.type === "tool-output") {
    return [
      prev,
      {
        role: "tool",
        tool_call_id: item.toolCallId,
        content: tagged(TOOL_RESPONSE_TAG, {}, `
This is an automated message. The output from the tool was:
${item.content}
You may or may not be done with your original task. If you need to make more edits or call more
tools, continue doing so. If you're done, or stuck, ask the user for help.`.trim())
      }
    ];
  }

  if(item.type === "file-outdated") {
    return [
      prev,
      {
        role: "tool",
        tool_call_id: item.toolCallId,
        content: `\n${tagged(TOOL_ERROR_TAG, {}, `
File could not be updated because it was modified after being last read.
The latest version of the file has been automatically re-read and placed in your context space.
Please try again.`.trim())}`,
      }
    ];
  }

  if(item.type === "tool-error") {
    if(prev && prev.role === "assistant") {
      return [
        {
          role: "assistant",
          content: prev.content || "",
          tool_calls: [{
            type: "function",
            id: item.original.id || "unknown",
            function: {
              name: item.original.function?.name || "unknown",
              arguments: item.original.function?.arguments || "{}",
            },
          }],
        },
        {
          role: "tool",
          tool_call_id: item.toolCallId,
          content: tagged(TOOL_ERROR_TAG, {}, item.error),
        }
      ];
    }
    if(prev) {
      throw new Error("Impossible tool ordering: no prev assistant response for tool error");
    }
    // Got this far? We're missing the prev assistant message due to windowing. Just skip this.
    return [ null, null ];
  }

  if(item.type === "assistant") {
    return [
      prev,
      {
        role: "assistant",
        content: item.content,
      },
    ];
  }

  if(item.type === "file-unreadable") {
    return [
      prev,
      {
        role: "tool",
        tool_call_id: item.toolCallId,
        content: tagged(
          TOOL_ERROR_TAG,
          {},
          `File ${item.path} could not be read. Has it been deleted?`,
        ),
      },
    ]
  }

  // Filter out request failed
  if(item.type === "request-failed") {
    return [ prev, null ];
  }

  // Type assertion we've handled all cases other than user
  const _: "user" = item.type;

  return [
    prev,
    {
      role: "user",
      content: item.content,
    },
  ];
}

let totalTokens = 0;
export function totalTokensUsed() {
  return totalTokens;
}

export async function runAgent(
  client: OpenAI,
  config: Config,
  history: HistoryItem[],
  contextSpace: ContextSpace,
  onTokens: (t: string, type: "reasoning" | "content") => any,
) {
  const processedHistory = applyContextWindow(history, config.context);
  if(processedHistory.appliedWindow) {
    contextSpace.window(processedHistory.history[0].id);
  }

  const messages = await toLlmMessages(
    processedHistory.history,
    processedHistory.appliedWindow,
    contextSpace,
    config
  );

  const res = await client.chat.completions.create({
    model: config.model,
    messages,
    stream: true,
    parallel_tool_calls: false,
    tools: Object.entries(toolMap).map(([ name, tool ]) => {
      const argJsonSchema = toJSONSchema("ignore", tool.ArgumentsSchema);
      // Delete JSON schema fields unused by OpenAI compatible APIs; some APIs will error if present
      // @ts-ignore
      delete argJsonSchema.$schema;
      delete argJsonSchema.description;
      // @ts-ignore
      delete argJsonSchema.title;

      return {
        type: "function",
        strict: true,
        function: {
          name: name,
          description: `The ${name} tool`,
          parameters: argJsonSchema,
        },
      };
    }),
    stream_options: {
      include_usage: true,
    },
    max_completion_tokens: config.context,
  });

  let content = "";
  let reasoningContent: undefined | string = undefined;
  let toolContent = "";
  let inToolTag = false;
  let usage = 0;

  // TODO: parse <think> tags (configurable what the tag is)
  const xmlParser = new StreamingXMLParser({
    whitelist: [ ],
    handlers: {
      onOpenTag: () => {
        inToolTag = true;
      },

      onCloseTag: () => {
        inToolTag = false;
      },

      onText: e => {
        if(inToolTag) toolContent += e.content;
        else {
          onTokens(e.content, "content");
          content += e.content;
        }
      },
    },
  });


  let currTool: Partial<ResponseToolCall> | null = null;
  let doneParsingTools = false;

  for await(const chunk of res) {
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
      const tokens = chunk.choices[0].delta.content || "";
      xmlParser.write(tokens);
    }
    else if(delta && "reasoning_content" in delta && delta.reasoning_content) {
      if(reasoningContent == null) reasoningContent = "";
      reasoningContent += delta.reasoning_content;
      onTokens(delta.reasoning_content, "reasoning");
    }
    else if(delta && "tool_calls" in delta && delta.tool_calls.length > 0) {
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

  // Make sure to close the parser to flush any remaining data
  xmlParser.close();

  // Calculate token usage delta from the previous total
  const tokenDelta = usage - totalTokens;
  totalTokens = usage;

  const assistantHistoryItem = {
    type: "assistant" as const,
    id: sequenceId(),
    content, reasoningContent,
    tokenUsage: tokenDelta,
  };

  // Check if we found a tool call
  if (currTool) {
    const validatedTool = ResponseToolCallSchema.sliceResult(currTool);
    if(validatedTool instanceof t.Err) {
      const toolCallId = currTool["id"];
      if(toolCallId == null) throw new Error("Impossible tool call: no id given");
      return history.concat([
        assistantHistoryItem,
        {
          type: "tool-error",
          id: sequenceId(),
          error: validatedTool.message,
          original: currTool,
          toolCallId,
        },
      ]);
    }

    const parseResult = parseTool(validatedTool, config);

    if(parseResult.status === "error") {
      return history.concat([
        assistantHistoryItem,
        {
          type: "tool-error",
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

// Apply sliding window to keep context under token limit
function applyContextWindow(history: HistoryItem[], context: number): {
  appliedWindow: boolean,
  history: HistoryItem[],
} {
  const MAX_CONTEXT_TOKENS = Math.floor(context * 0.8);

  let totalTokens = 0;
  for(const item of history) {
    if(item.type === "assistant") totalTokens += item.tokenUsage;
  }
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

function parseTool(toolCall: ResponseToolCall, config: Config): ParseToolResult {
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
  try {
    const parsed = toolSchema.slice({
      name: toolCall.function.name,
      arguments: toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {},
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
