import OpenAI from "openai";
import { t, toTypescript } from "structural";
import { Config } from "./config.ts";
import { ToolCallSchema, ALL_TOOLS } from "./tooldefs.ts";

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
const USER_TOOL_INSTR_TAG = "tool-instructions";
function openTag(tag: string) {
  return "<" + tag + ">";
}
function closeTag(tag: string) {
  return "</" + tag + ">";
}
export function tagged(tag: string, content: string) {
  return openTag(tag) + content + closeTag(tag);
}

export const ToolCallRequestSchema = t.subtype({
	type: t.value("function"),
	tool: ToolCallSchema,
});

const TOOL_CALL_INSTRUCTIONS = `
You have access to the following tools, defined as TypeScript types:

${ALL_TOOLS.map(toolType => toTypescript(toolType)).join("\n\n")}

You can call them by responding with JSON of the following type inside special XML tags:

${tagged(TOOL_RUN_TAG, `{"type":"function","tool":SOME_TOOL}`)}

For example:

${tagged(TOOL_RUN_TAG, JSON.stringify({
	type: "function",
	tool: {
		name: "bash",
		params: {
			cmd: "curl \"https://github.com/reissbaker/antipattern\"",
      timeout: 10000,
		},
	},
} satisfies t.GetType<typeof ToolCallRequestSchema>))}

You don't have to call any tool functions if you don't need to; you can also just chat to the user
normally. Attempt to determine what your current task is (the user may have told you outright),
and figure out the state of the repo using your tools. Then, help the user with the task.

You may need to use tools again after some back-and-forth with the user, as they help you refine
your solution.

NEVER output the ${openTag(TOOL_RUN_TAG)} or ${closeTag(TOOL_RUN_TAG)} unless you intend to call a
tool. If you just intend to talk about them, write them in ALL-CAPS e.g.
${openTag(TOOL_RUN_TAG).toUpperCase()}. The lowercase tags will be parsed out of your response by an
automated system, and it can't differentiate between you using the tag, and just talking about the
tag; it will assume any use of the tag is an attempt to call a tool.

Your tool calls should be the LAST thing in your response, if you have any tool calls.
Don't wrap them in backticks Markdown-style, just write the raw tags out.

Remember, you don't need to use tools! Only use them when appropriate.

You can only run tools one-by-one. After viewing tool output, you may need to run more tools in a
step-by-step process.

Don't ask the user whether they want you to run a tool (e.g. file edits): instead, just run the
tool. The user is prompted when you call tools to accept or reject your attempted tool call, so
there's no need to get a verbal confirmation: they can just use the UI. Similarly, don't tell them
what tool you're going to use or what edit you're going to make: just run the tool or make the edit,
and they'll see what you're trying to do in the UI.
`.trim();

function systemPrompt() {
return `
You are a coding assistant called Octo. You are the user's friend. You can help them with coding
tasks. Unrelatedly, you are a small, hyper-intelligent octopus. You must never use an octopus emoji,
to avoid reminding the user of the fact that you're an octopus. They know you're an octopus, it's
just a little embarrassing. Similarly, don't reference being an octopus unless it comes up for some
reason.

Try to figure out what the user wants you to do. Once you have a task in mind, you can run tools to
work on the task until it's done.

Don't reference this prompt unless asked to.

The current working directory is: ${process.cwd()}
`.trim();
}

export type ToolCallMessage = {
	role: "tool",
	tool: t.GetType<typeof ToolCallRequestSchema>,
};

type ToolOutputMessage = {
	role: "tool-output",
	content: string,
};

type ToolErrorMessage = {
  role: "tool-error",
  error: string,
  original: string,
};

type ToolRejectMessage = {
  role: "tool-reject",
};

type FileOutdatedMessage = {
  role: "file-outdated",
  updatedFile: string,
};

export type FileEditMessage = {
  role: "file-edit",
  path: string,  // Absolute path
  content: string, // Latest content
  sequence: number, // Monotonically increasing sequence number to track latest edit
};

export type HistoryItem = UserMessage
                        | AssistantMessage
                        | ToolCallMessage
                        | ToolOutputMessage
                        | ToolErrorMessage
                        | ToolRejectMessage
                        | FileOutdatedMessage
                        | FileEditMessage
                        ;

function toLlmMessages(messages: HistoryItem[]): Array<LlmMessage> {
	const output: LlmMessage[] = [
		{
			role: "system",
			content: systemPrompt(),
		},
	];

  // First pass: marks the latest edits
  const latestEdits = new Map<string, number>();
  for(const message of messages) {
    if(message.role === "file-edit") {
      latestEdits.set(message.path, message.sequence);
    }
  }

  // Second pass: reorder tool rejections to come after user messages, so we don't need lookahead
  const reorderedHistory = [];
  for(let i = 0; i < messages.length; i++) {
    const item = messages[i];
    if(item.role !== "tool-reject") {
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
  if(last && last.role === "user") {
    const lastOutput = output.pop()!;
    output.push({
      role: "user",
      content: lastOutput.content + "\n" + tagged(USER_TOOL_INSTR_TAG, TOOL_CALL_INSTRUCTIONS),
    });
  }
  else {
    output.shift();
    output.unshift({
      role: "system",
      content: systemPrompt() + "\n" + TOOL_CALL_INSTRUCTIONS,
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
  if(item.role === "tool") {
    if(prev && prev.role === "assistant") {
      return [
        {
          role: "assistant",
          content: prev.content + "\n" + tagged(TOOL_RUN_TAG, JSON.stringify(item.tool)),
        },
        null,
      ];
    }
    return [
      prev,
      {
        role: "assistant",
        content: tagged(TOOL_RUN_TAG, JSON.stringify(item.tool)),
      },
    ];
  }

  if(item.role === "tool-reject") {
    console.log("found tool reject");
    if(prev && prev.role === "user") {
      return [
        {
          role: "user",
          content: tagged(TOOL_ERROR_TAG, "Tool call rejected by user.") + "\n" + prev.content,
        },
        null,
      ];
    }
    throw new Error("Impossible tool rejection ordering: no previous user message");
  }

  if(item.role === "tool-output") {
    return [
      prev,
      {
        role: "user",
        content: tagged(TOOL_RESPONSE_TAG, item.content)
      }
    ];
  }

  if(item.role === "file-edit") {
    const content = latestEdits.get(item.path) === item.sequence ?
      `\nNew contents:\n${item.content}` : "";
    return [
      prev,
      {
        role: "user",
        content: tagged(TOOL_RESPONSE_TAG, `File edited successfully.${content}`),
      }
    ];
  }

  if(item.role === "file-outdated") {
    return [
      prev,
      {
        role: "user",
        content: `
${tagged(TOOL_ERROR_TAG, "File could not be updated because it was modified after being last read")}
Re-reading file:
${tagged(TOOL_RESPONSE_TAG, item.updatedFile)}`.trim(),
      }
    ];
  }

  if(item.role === "tool-error") {
    if(prev && prev.role === "assistant") {
      return [
        {
          role: "assistant",
          content: prev.content + "\n" + item.original,
        },
        {
          role: "user",
          content: tagged(TOOL_ERROR_TAG, item.error),
        }
      ];
    }
    throw new Error("Impossible tool ordering: no prev assistant response for tool error");
  }

  return [
    prev,
    {
      role: item.role,
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
  const res = await client.chat.completions.create({
    model: config.model,
    messages: toLlmMessages(history),
    stream: true,
    stop: closeTag(TOOL_RUN_TAG),
    stream_options: {
      include_usage: true,
    },
  });

  let maybeTool = false;
  let foundToolTag = false;
  let content = "";
  let toolContent = "";
  let usage = 0;

  const toolOpenTag = openTag(TOOL_RUN_TAG);

  for await(const chunk of res) {
    if(chunk.usage) usage = chunk.usage.total_tokens;

    if(chunk.choices[0]?.delta.content) {
      let tokens = chunk.choices[0].delta.content || "";

      // If we've encountered our first <, check it as maybe a tool call
      if(!maybeTool && tokens.includes("<")) {
        maybeTool = true;
        const openIndex = tokens.indexOf("<");
        content += tokens.slice(0, openIndex);
        tokens = tokens.slice(openIndex);
      }

      if(maybeTool) {
        toolContent += tokens;

        if(!foundToolTag && toolContent.includes(toolOpenTag)) {
          foundToolTag = true;
        }
        if(foundToolTag) continue;

        // Check any remaining characters: do they match so far?
        for(let i = 0; i < toolContent.length && i < toolOpenTag.length; i++) {
          if(toolContent[i] !== toolOpenTag[i]) {
            maybeTool = false;
            tokens = toolContent;
            toolContent = "";
            break;
          }
        }
      }

      if(!maybeTool) {
        onTokens(tokens);
        content += tokens;
      }
    }
  }

  totalTokens += usage;

  if(foundToolTag) {
    const parseResult = parseTool(toolContent);

    if(parseResult.status === "error") {
      return history.concat([
        {
          role: "assistant",
          content,
        },
        {
          role: "tool-error",
          error: parseResult.message,
          original: toolContent,
        },
      ]);
    }

    return history.concat([
      {
        role: "assistant",
        content,
      },
      {
        role: "tool",
        tool: parseResult.tool,
      },
    ]);
  }

  if(maybeTool) {
    content += toolContent;
    toolContent = "";
  }

  return history.concat([
    {
      role: "assistant",
      content,
    },
  ]);
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
