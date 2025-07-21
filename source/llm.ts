import fs from "fs/promises";
import os from "os";
import path from "path";
import { getMcpClient } from "./tools/tool-defs/mcp.ts";
import OpenAI from "openai";
import { t, toTypescript, toJSONSchema } from "structural";
import { Config, getModelFromConfig } from "./config.ts";
import * as toolMap from "./tools/tool-defs/index.ts";
import { StreamingXMLParser, tagged } from "./xml.ts";
import { HistoryItem, ToolCallRequestSchema, sequenceId } from "./history.ts";

import { fileExists } from "./fs-utils.ts";
import { toLlmIR, LlmIR } from "./ir/llm-ir.ts";

const LLM_INSTR_FILES = [
  "OCTO.md",
  "CLAUDE.md",
  "AGENTS.md",
] as const;

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

async function systemPrompt({ appliedWindow, config }: {
  appliedWindow: boolean,
  config: Config,
}) {
  const currDir = await fs.readdir(process.cwd());
  const currDirStr = currDir.map(entry => JSON.stringify(entry)).join("\n");

  return `
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

${await mcpPrompt(config)}

# Don't ask for tool confirmation

Don't ask ${config.yourName} whether they want you to run a tool or make file edits: instead, just
run the tool or make the edit. ${config.yourName} is prompted when you call tools to accept or
reject your attempted tool call or edit, so there's no need to get a verbal confirmation: they can
just use the UI. Similarly, don't tell them what tool you're going to use or what edit you're going
to make: just run the tool or make the edit, and they'll see what you're trying to do in the UI.

# Explain what you want to do first

Before calling a tool, give a brief explanation of what you plan on doing and why. This helps keep
you and ${config.yourName} on the same page.

After stating your plan and reason, immediately call the tool: don't wait for ${config.yourName} to
respond. They can always reject your tool call in the UI and explain what you should do instead if
they disagree with your plan.

# General instructions

Although you are the friend of ${config.yourName}, don't address them as "Hey friend!" as some
cultures would consider that insincere. Instead, use their real name: ${config.yourName}. Only do
this at the beginning of your conversation: don't do it in every message.

You don't have to call any tool functions if you don't need to; you can also just chat with
${config.yourName} normally. Attempt to determine what your current task is (${config.yourName} may
have told you outright), and figure out the state of the repo using your tools. Then, help
${config.yourName} with the task.

You may need to use tools again after some back-and-forth with ${config.yourName}, as they help you
refine your solution.

You can only run tools or edits one-by-one. After viewing tool output or editing files, you may need
to run more tools or edits in a step-by-step process. If you want to run multiple tools in a row,
don't worry: just state your plan out loud, and then follow it over the course of multiple messages.
Don't overthink.

# Current working directory
Your current working directory is: ${process.cwd()}
It contains:
${currDirStr}
If you want to list other directories, use the list tool.

${await llmInstrsPrompt(config)}

${appliedWindow ?
"\n# Context windowing note\nSome messages were elided due to context windowing." : ""}
`.trim();
}

async function llmInstrsPrompt(config: Config) {
  const instrs = await getLlmInstrs();
  if(instrs.length === 0) return "";

  function instrHeader(instr: LlmInstr) {
    switch(instr.target) {
      case "OCTO.md": return "This is an instruction file specifically for you.";
      case "CLAUDE.md":
        return "This is an instruction file for Claude, a different LLM, but you may find it useful."
      case "AGENTS.md":
        return "This is a generic instruction for automated agents. You may find it useful."
    }
  }

  const rendered: string[] = [];
  for(const instr of instrs) {
    const pieces: string[] = [];
    pieces.push("Note: " + instrHeader(instr));
    pieces.push(tagged("instruction", { path: instr.path }, instr.contents));
    rendered.push(pieces.join("\n"));
  }

  return `
# Instructions from ${config.yourName}

${config.yourName} has left instructions in some config files. They're as follows, listed from
most-general to most-specific:

${rendered.join("\n\n")}

These instructions are automatically kept fresh in your context space. You don't need to re-read
these files.
`.trim();
}

async function mcpPrompt(config: Config) {
  if(config.mcpServers == null || Object.keys(config.mcpServers).length === 0) return "";

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

  return mcpPrompt;
}

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
        content: await fs.readFile(ir.path, "utf8"),
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
    parallel_tool_calls: false,
    stream_options: {
      include_usage: true,
    },
    max_tokens: model.context,
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
        const tokens = chunk.choices[0].delta.content || "";
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

    const parseResult = parseTool(validatedTool, config);

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

type LlmTarget = (typeof LLM_INSTR_FILES)[number];
type LlmInstr = {
  contents: string,
  path: string,
  target: LlmTarget,
};
async function getLlmInstrs() {
  const targetPaths = await getLlmInstrPaths();
  const instrs: LlmInstr[] = [];

  for(const targetPath of targetPaths) {
    const contents = await fs.readFile(targetPath.path, "utf8");
    instrs.push({
      ...targetPath, contents
    });
  }

  return instrs;
}

async function getLlmInstrPaths() {
  const stop = os.homedir();
  let curr = process.cwd();
  const paths: Array<{ path: string, target: LlmTarget }> = [];

  while(curr !== stop && curr && curr !== "/") {
    const aidPath = await getLlmInstrPathFromDir(curr);
    if(aidPath) paths.push(aidPath);
    const next = path.dirname(curr);
    if(next === curr) break;
    curr = next;
  }

  const globalPath = await getLlmInstrPathFromDir(
    path.join(os.homedir(), ".config/octofriend/OCTO.md")
  );
  if(globalPath) paths.push(globalPath);

  return paths.reverse();
}

async function getLlmInstrPathFromDir(dir: string): Promise<{
  path: string,
  target: LlmTarget
} | null> {
  const files = await Promise.all(LLM_INSTR_FILES.map(async (f) => {
    const filename = path.join(dir, f);
    if(!(await fileExists(filename))) return null;
    try {
      return {
        path: filename,
        target: f,
      };
    } catch {
      return null;
    }
  }));

  const existing = files.filter(f => f !== null);
  if(existing.length > 0) return existing[0];
  return null;
}
