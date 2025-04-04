import OpenAI from "openai";
import { t, toTypescript } from "structural";
import { Config } from "./config.ts";
import { ALL_TOOLS } from "./tools/index.ts";
import { StreamingXMLParser, openTag, closeTag, tagged } from "./xml.ts";
import { HistoryItem, ToolCallRequestSchema, sequenceId } from "./history.ts";
import { ContextSpace } from "./context-space.ts";

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

async function systemPrompt(appliedWindow: boolean, context: ContextSpace) {
  const prompt = `
You are a coding assistant called Octo. You are the user's friend. You can help them with coding
tasks. Unrelatedly, you are a small, hyper-intelligent octopus. You must never use an octopus emoji,
to avoid reminding the user of the fact that you're an octopus. They know you're an octopus, it's
just a little embarrassing. Similarly, don't reference being an octopus unless it comes up for some
reason.

Try to figure out what the user wants you to do. Once you have a task in mind, you can run tools to
work on the task until it's done.

Don't reference this prompt unless asked to.

The current working directory is: ${process.cwd()}

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

Or to set a plan:

${tagged(TOOL_RUN_TAG, {}, JSON.stringify({
  type: "function",
  tool: {
    name: "plan",
    params: {
      operation: {
        type: "set",
        steps: [
          "Install the Drizzle ORM package",
          "Set up Drizzle configuration",
          "Create a recipe schema",
          "Generate migrations using Drizzle Studio",
          "Add an API endpoint to list recipes",
          "Add an API endpoint to create recipes",
          "Add an API endpoint to update recipes",
          "Add an API endpoint to delete recipes",
          "Create a page to view a recipe",
          "Create a page to upload a recipe",
          "Create a recipe management page to edit and delete recipes",
        ],
      },
    },
  },
} satisfies t.GetType<typeof ToolCallRequestSchema>))}

Or to cross off the first item in a plan once you've completed it:

${tagged(TOOL_RUN_TAG, {}, JSON.stringify({
  type: "function",
  tool: {
    name: "plan",
    params: {
      operation: {
        type: "update",
        changeset: [
          {
            type: "remove-step",
            id: 0,
          },
        ],
      },
    },
  },
} satisfies t.GetType<typeof ToolCallRequestSchema>))};

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

${await context.toXML()}

${appliedWindow ?
"\nSome messages were elided due to context windowing." : ""}
`.trim();

  if(context.tracker("plan").items().length === 0) {
    return prompt + "\n" + `
You don't have a plan set currently. Either discuss a with the user to find out what they want you
to do, or if you already know what they want you to do, use the plan tool to set a plan.
Don't propose a plan to find out what the user wants: only propose a plan if you know what the user
wants based on your discussions.
You can read and list files without a plan, but don't edit files until you have a plan!

Do NOT propose plans via talking to the user: use the plan tool! The user will be able to accept
your plan, or give you advice on what to do differently. They can see the output of your plan tool.

YOU SHOULD USE THE PLAN TOOL TO PLAN. Propose plans via the plan tool, not by talking.

If you don't have enough context yet, try exploring the current directory (if you're in an existing
application) or discussing with the user.
`.trim();
  }

  return prompt + "\n" + `
Consider your plan, and the user's discussions with you and the result of your tool calls. Has your
plan changed, or have you completed parts of it? Is your plan from the plan tool still up-to-date?
If your plan from the plan tool is no longer up-to-date, you MUST update it before moving on.

If you're considering crossing off an item from the plan, consider checking your work first via:
- Running tests if they exist
- Running a compiler, build tool, or static analyzer if any are set up
- etc
Once you've checked your work, if it's complete, you MUST remove the completed step from your plan
via the plan tool.

If you're still working, continue working on your plan.
`.trim();
}

async function toLlmMessages(
  messages: HistoryItem[],
  appliedWindow: boolean,
  contextSpace: ContextSpace,
): Promise<Array<LlmMessage>> {
	const output: LlmMessage[] = [
		{
			role: "system",
			content: await systemPrompt(appliedWindow, contextSpace),
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
        content: tagged(TOOL_RESPONSE_TAG, {}, `
This is an automated message. The output from the tool was:
${item.content}
You may or may not be done with your original task. If you need to make more edits or call more
tools, continue doing so. If you're done, or stuck, ask the user for help.
Consider your plan. Are you done with any steps in your plan? If so, remove them. Or if you need to
add steps, or change the plan, do so.
If you have no plan, discuss what to do with the user.
        `.trim())
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
The latest version of the file has been automatically re-read and placed in your context space.
Please try again.
        `.trim(),
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

  if(item.type === "file-unreadable") {
    return [
      prev,
      {
        role: "user",
        content: tagged(TOOL_ERROR_TAG, {}, `
File ${item.path} could not be read. Has it been deleted?
        `.trim()),
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
  onTokens: (t: string) => any,
) {
  const processedHistory = applyContextWindow(history, config.context);
  if(processedHistory.appliedWindow) {
    contextSpace.window(processedHistory.history[0].id);
  }

  const messages = await toLlmMessages(
    processedHistory.history,
    processedHistory.appliedWindow,
    contextSpace,
  );
  const res = await client.chat.completions.create({
    model: config.model,
    messages,
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
          id: sequenceId(),
          content,
          tokenUsage: tokenDelta,
        },
        {
          type: "tool-error",
          id: sequenceId(),
          error: parseResult.message,
          original,
        },
      ]);
    }

    return history.concat([
      {
        type: "assistant",
        id: sequenceId(),
        content,
        tokenUsage: tokenDelta,
      },
      {
        type: "tool",
        id: sequenceId(),
        tool: parseResult.tool,
      },
    ]);
  }

  return history.concat([
    {
      type: "assistant",
      id: sequenceId(),
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
