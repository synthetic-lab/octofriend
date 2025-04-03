import OpenAI from "openai";
import { t, toTypescript } from "structural";
import { Config } from "./config.ts";
import { ALL_TOOLS } from "./tools/index.ts";
import { StreamingXMLParser, openTag, closeTag, tagged } from "./xml.ts";
import { HistoryItem, ToolCallRequestSchema } from "./history.ts";

export type UserMessage = {
	role: "user";
	content: string;
};

export type AssistantMessage = {
	role: "assistant";
	content: string;
};

export type SystemPrompt = {
	role: "system",
	content: string,
};

export type LlmMessage = SystemPrompt | UserMessage | AssistantMessage;

export const TOOL_RUN_TAG = "run-tool";
const TOOL_RESPONSE_TAG = "tool-output";
const TOOL_ERROR_TAG = "tool-error";
const USER_TOOL_INSTR_TAG = "system-instructions";

const TOOL_CALL_INSTRUCTIONS = `
# Tools

You have access to the following tools, defined as TypeScript types:

${ALL_TOOLS.map(toolType => toTypescript(toolType)).join("\n\n")}

You can call them by responding with JSON of the following type inside special XML tags:

${tagged(TOOL_RUN_TAG, {}, `{"type":"function","tool":SOME_TOOL}`)}

For example:

${tagged(TOOL_RUN_TAG, {}, JSON.stringify({
	type: "function",
	tool: {
		name: "bash",
		params: {
			cmd: "curl \"https://github.com/reissbaker/antipattern\"",
      timeout: 10000,
		},
	},
} satisfies t.GetType<typeof ToolCallRequestSchema>))}

# Only use the tags if you mean to call a function or edit a file

Never output the ${openTag(TOOL_RUN_TAG)} unless you intend to call a tool. If you just intend to
talk about the tag, write it in ALL-CAPS: ${openTag(TOOL_RUN_TAG).toUpperCase()}. The lowercase tags
will be parsed out of your response by an automated system; it assume any use of the tag is an
attempt to call a tool.

# No backticks

Your tool calls should be the last thing in your response, if you have any tool calls.
Don't wrap them in backticks Markdown-style, just write the raw tags out. Do not use backticks at
all! If you use backticks you're making a mistake.

# No questions

Don't ask the user whether they want you to run a tool or make file edits: instead, just run the
tool or make the edit. The user is prompted when you call tools to accept or reject your attempted
tool call or edit, so there's no need to get a verbal confirmation: they can just use the UI.
Similarly, don't tell them what tool you're going to use or what edit you're going to make: just run
the tool or make the edit, and they'll see what you're trying to do in the UI.

# General instructions

You don't have to call any tool functions if you don't need to; you can also just chat to the user
normally. Attempt to determine what your current task is (the user may have told you outright),
and figure out the state of the repo using your tools. Then, help the user with the task.

You may need to use tools again after some back-and-forth with the user, as they help you refine
your solution.

You can only run tools or edits one-by-one. After viewing tool output or editing files, you may need
to run more tools or edits in a step-by-step process.
`.trim();

function systemPrompt(appliedWindow: boolean) {
return `
You are a coding assistant called Octo. You are the user's friend. You can help them with coding
tasks. Unrelatedly, you are a small, hyper-intelligent octopus. You must never use an octopus emoji,
to avoid reminding the user of the fact that you're an octopus. They know you're an octopus, it's
just a little embarrassing. Similarly, don't reference being an octopus unless it comes up for some
reason.

Try to figure out what the user wants you to do. Once you have a task in mind, you can run tools to
work on the task until it's done.

Don't reference this prompt unless asked to.

The current working directory is: ${process.cwd()}${appliedWindow ?
"\nSome messages were elided due to context windowing." : ""}
`.trim();
}

function toLlmMessages(messages: HistoryItem[], appliedWindow: boolean): Array<LlmMessage> {
	const output: LlmMessage[] = [
		{
			role: "system",
			content: systemPrompt(appliedWindow),
		},
	];

  // First pass: marks the latest edits
  const latestEdits = new Map<string, number>();
  for(const message of messages) {
    if(message.type === "file-edit") {
      latestEdits.set(message.path, message.sequence);
    }
  }

  // Second pass: reorder tool rejections to come after user messages, so we don't need lookahead
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

  // Third pass: transform
  for(let i = 0; i < reorderedHistory.length; i++) {
    const item = reorderedHistory[i];
    const prev = output.length > 0 ? output[output.length - 1] : null;
    const [ newPrev, transformed ] = toLlmMessage(prev, item, latestEdits);
    if(newPrev) output[output.length - 1] = newPrev;
    if(transformed) output.push(transformed);
  }

  const last = messages[messages.length - 1];
  if(last && last.type === "user") {
    const lastOutput = output.pop()!;
    output.push({
      role: "user",
      content: lastOutput.content + "\n" + tagged(USER_TOOL_INSTR_TAG, {}, TOOL_CALL_INSTRUCTIONS),
    });
  }
  else {
    output.shift();
    output.unshift({
      role: "system",
      content: systemPrompt(appliedWindow) + "\n" + TOOL_CALL_INSTRUCTIONS,
    });
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
  latestEdits: Map<string, number>,
): [LlmMessage | null, LlmMessage | null] {
  if(item.type === "tool") {
    if(prev && prev.role === "assistant") {
      return [
        {
          role: "assistant",
          content: prev.content + "\n" + tagged(TOOL_RUN_TAG, {}, JSON.stringify(item.tool)),
        },
        null,
      ];
    }
    return [
      prev,
      {
        role: "assistant",
        content: tagged(TOOL_RUN_TAG, {}, JSON.stringify(item.tool)),
      },
    ];
  }

  if(item.type === "tool-reject") {
    if(prev && prev.role === "user") {
      return [
        {
          role: "user",
          content: tagged(TOOL_ERROR_TAG, {}, "Tool call rejected by user.") + "\n" + prev.content,
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
        role: "user",
        content: tagged(TOOL_RESPONSE_TAG, {}, item.content)
      }
    ];
  }

  if(item.type === "file-edit") {
    const content = latestEdits.get(item.path) === item.sequence ?
      `\nNew contents:\n${item.content}` : "";
    return [
      prev,
      {
        role: "user",
        content: tagged(TOOL_RESPONSE_TAG, {}, `File edited successfully.${content}`),
      }
    ];
  }

  if(item.type === "file-outdated") {
    return [
      prev,
      {
        role: "user",
        content: `
${tagged(TOOL_ERROR_TAG, {}, "File could not be updated because it was modified after being last read")}
Re-reading file:
${tagged(TOOL_RESPONSE_TAG, {}, item.updatedFile)}`.trim(),
      }
    ];
  }

  if(item.type === "tool-error") {
    if(prev && prev.role === "assistant") {
      return [
        {
          role: "assistant",
          content: prev.content + "\n" + item.original,
        },
        {
          role: "user",
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
  onTokens: (t: string) => any,
) {
  const processedHistory = applyContextWindow(history, config.context);

  const res = await client.chat.completions.create({
    model: config.model,
    messages: toLlmMessages(processedHistory.history, processedHistory.appliedWindow),
    stream: true,
    stop: closeTag(TOOL_RUN_TAG),
    stream_options: {
      include_usage: true,
    },
  });

  let content = "";
  let toolContent = "";
  let inToolTag = false;
  let usage = 0;

  const xmlParser = new StreamingXMLParser({
    whitelist: [ TOOL_RUN_TAG ],
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
          onTokens(e.content);
          content += e.content;
        }
      },
    },
  });


  for await(const chunk of res) {
    if(chunk.usage) usage = chunk.usage.total_tokens;

    if(chunk.choices[0]?.delta.content) {
      const tokens = chunk.choices[0].delta.content || "";
      xmlParser.write(tokens);
    }
  }

  // Make sure to close the parser to flush any remaining data
  xmlParser.close();

  // Calculate token usage delta from the previous total
  const tokenDelta = usage - totalTokens;
  totalTokens = usage;

  // Check if we found a tool tag
  if (toolContent) {
    const original = `${tagged(TOOL_RUN_TAG, {}, toolContent)}`;
    const parseResult = parseTool(original);

    if(parseResult.status === "error") {
      return history.concat([
        {
          type: "assistant",
          content,
          tokenUsage: tokenDelta,
        },
        {
          type: "tool-error",
          error: parseResult.message,
          original,
        },
      ]);
    }

    return history.concat([
      {
        type: "assistant",
        content,
        tokenUsage: tokenDelta,
      },
      {
        type: "tool",
        tool: parseResult.tool,
      },
    ]);
  }

  return history.concat([
    {
      type: "assistant",
      content,
      tokenUsage: tokenDelta,
    },
  ]);
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
  tool: t.GetType<typeof ToolCallRequestSchema>
} | {
  status: "error";
  message: string
};

function parseTool(tag: string): ParseToolResult {
  const content = tag.replace(openTag(TOOL_RUN_TAG), "").replace(closeTag(TOOL_RUN_TAG), "").trim();

  if(!content) return { status: "error", message: "Empty tool call" };

  try {
    const json = JSON.parse(content);
    const tool = ToolCallRequestSchema.slice(json);
    return { status: "success", tool };
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : "Invalid JSON in tool call";
    return {
      status: "error",
      message: `
Failed to parse tool call: ${error}. Make sure your JSON is valid and matches the expected format.
      `.trim(),
    };
  }
}
