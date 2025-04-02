import OpenAI from "openai";
import { t, toTypescript } from "structural";
import { Config } from "./config.ts";
import { ToolCallSchema, VISIBLE_TOOLS } from "./tools/index.ts";
import sax from "sax";

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
export const EDIT_RUN_TAG = "run-edit";
const DIFF_SEARCH_TAG = "diff-search";
const DIFF_REPLACE_TAG = "diff-replace";

// Define tags that we'll parse from LLM output
const LLM_TAGS = [TOOL_RUN_TAG, EDIT_RUN_TAG, DIFF_SEARCH_TAG, DIFF_REPLACE_TAG] as const;
type LlmTag = (typeof LLM_TAGS)[number];

// Type guard for LLM tags
function isLlmTag(tag: string): tag is LlmTag {
  return LLM_TAGS.includes(tag as LlmTag);
}

// Structure to track tag state and content
type TagState = {
  active: boolean;
  content?: string;
};
function openTag(tag: string, attrs?: Record<string, string>) {
  if (!attrs || Object.keys(attrs).length === 0) {
    return "<" + tag + ">";
  }
  
  const attrString = Object.entries(attrs)
    .map(([key, value]) => `${key}="${value}"`)
    .join(" ");
    
  return "<" + tag + " " + attrString + ">";
}

function closeTag(tag: string) {
  return "</" + tag + ">";
}

export function tagged(tag: string, attrs: Record<string, string> = {}, ...content: string[]) {
  return openTag(tag, attrs) + content.join("") + closeTag(tag);
}

export const ToolCallRequestSchema = t.subtype({
	type: t.value("function"),
	tool: ToolCallSchema,
});

const TOOL_CALL_INSTRUCTIONS = `
You have access to the following tools, defined as TypeScript types:

${VISIBLE_TOOLS.map(toolType => toTypescript(toolType)).join("\n\n")}

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

You also have access to the following XML-based file editing syntax for more natural code editing:

1. For file editing with diff search/replace:
${tagged(EDIT_RUN_TAG,
  { filepath: "src/example.ts", type: "diff" },
  tagged(DIFF_SEARCH_TAG, {}, "text to search for"),
  tagged(DIFF_REPLACE_TAG, {}, "text to replace it with")
)}
The search string musst exactly match the old content, including whitespace: it's
whitespace-sensitive. Make sure it doesn't match anything else in the file, or you may inadvertantly
edit a line you don't mean to. It may help to include some extra context such as the line above and
the line below the content you intend to replace: if you do so, make sure to include those lines in
your ${openTag(DIFF_REPLACE_TAG)} as well, so that they don't get deleted! For example:

\`\`\`javascript
// test.js
let test = 1;
console.log(test);
test += 1
console.log(test);
\`\`\`

To delete the final console.log line, do this:

${tagged(EDIT_RUN_TAG,
  { filepath: "test.js", type: "diff" },
  tagged(DIFF_SEARCH_TAG, {}, "test += 1\nconsole.log(test)"),
  tagged(DIFF_REPLACE_TAG, {}, "test += 1")
)}

2. For appending to a file:
${tagged(EDIT_RUN_TAG,
  { filepath: "src/example.ts", type: "append" },
  "content to append"
)}

3. For prepending to a file:
${tagged(EDIT_RUN_TAG, 
  { filepath: "src/example.ts", type: "prepend" },
  "content to prepend"
)}

4. For creating a new file:
${tagged(EDIT_RUN_TAG, 
  { filepath: "src/new-file.ts", type: "create" },
  "file content"
)}

You don't have to call any tool functions if you don't need to; you can also just chat to the user
normally. Attempt to determine what your current task is (the user may have told you outright),
and figure out the state of the repo using your tools. Then, help the user with the task.

You may need to use tools again after some back-and-forth with the user, as they help you refine
your solution.

NEVER output any of these XML tags unless you intend to call a tool:
${openTag(TOOL_RUN_TAG)}, ${openTag(EDIT_RUN_TAG)}, ${openTag(DIFF_SEARCH_TAG)}, ${openTag(DIFF_REPLACE_TAG)}

If you just intend to talk about these tags, write them in ALL-CAPS e.g.
${openTag(TOOL_RUN_TAG).toUpperCase()}. The lowercase tags will be parsed out of your response by an
automated system, and it can't differentiate between you using a tag and just talking about a
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

export type AssistantHistoryMessage = {
  role: "assistant-history";
  content: string;
  tokenUsage: number; // Delta token usage from previous message
};

export type HistoryItem = UserMessage
                        | AssistantHistoryMessage
                        | ToolCallMessage
                        | ToolOutputMessage
                        | ToolErrorMessage
                        | ToolRejectMessage
                        | FileOutdatedMessage
                        | FileEditMessage
                        ;

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
  if(item.role === "tool") {
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

  if(item.role === "tool-reject") {
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

  if(item.role === "tool-output") {
    return [
      prev,
      {
        role: "user",
        content: tagged(TOOL_RESPONSE_TAG, {}, item.content)
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
        content: tagged(TOOL_RESPONSE_TAG, {}, `File edited successfully.${content}`),
      }
    ];
  }

  if(item.role === "file-outdated") {
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

  if(item.role === "tool-error") {
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

  if(item.role === "assistant-history") {
    return [
      prev,
      {
        role: "assistant",
        content: item.content,
      },
    ];
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
  const processedHistory = applyContextWindow(history, config.context);

  const res = await client.chat.completions.create({
    model: config.model,
    messages: toLlmMessages(processedHistory.history, processedHistory.appliedWindow),
    stream: true,
    stop: [closeTag(TOOL_RUN_TAG), closeTag(EDIT_RUN_TAG)],
    stream_options: {
      include_usage: true,
    },
  });

  let content = "";
  let usage = 0;

  const parser = sax.parser(false, {
    lowercase: true,
    position: false
  });

  type TagStates = {
    [K in LlmTag]: TagState
  };

  const tagStates: TagStates = Object.fromEntries(
    LLM_TAGS.map(tag => [tag, { active: false }])
  ) as TagStates;

  // Edit attributes
  let editFileType: string | undefined = undefined;
  let editFilePath: string | undefined = undefined;
  let currentText = "";

  // Track validation errors with the original content that caused them
  type ValidationError = {
    error: string;
    original: string;
  };
  let validationError: ValidationError | null = null as ValidationError | null;

  // Track the XML being parsed to handle unknown tags
  let openTagStrings: string[] = [];

  parser.onopentag = (node) => {
    const tagName = node.name;
    let attrString = "";

    // Format attributes for unknown tags
    if (node.attributes) {
      for (const [key, value] of Object.entries(node.attributes)) {
        attrString += ` ${key}="${value}"`;
      }
    }

    // Store the opening tag string
    const openTagStr = `<${tagName}${attrString}>`;
    openTagStrings.push(openTagStr);

    if(isLlmTag(tagName)) {
      tagStates[tagName].active = true;
      tagStates[tagName].content = tagStates[tagName].content || "";
    }

    // Add the opening tag to all active parent tags' content
    for (const tag of LLM_TAGS) {
      if (tag !== tagName && tagStates[tag].active) {
        tagStates[tag].content = (tagStates[tag].content || "") + openTagStr;
      }
    }

    // Unknown tag - treat as text content
    if(!isLlmTag(tagName)) {
      // If no active tags, add to regular content
      if (!LLM_TAGS.some(tag => tagStates[tag].active)) {
        content += openTagStr;
      }
      return;
    }

    // Handle specific tag requirements
    if (tagName === EDIT_RUN_TAG) {
      if (node.attributes) {
        if(typeof node.attributes["filepath"] === "string") {
          editFilePath = node.attributes["filepath"];
        }
        if(typeof node.attributes["type"] === "string") {
          editFileType = node.attributes['type'];
        }
      }
    }
    else if (tagName === DIFF_SEARCH_TAG || tagName === DIFF_REPLACE_TAG) {
      // These tags must be inside an edit tag
      if (!tagStates[EDIT_RUN_TAG].active) {
        validationError = {
          error: `${tagName} tag must be inside a ${EDIT_RUN_TAG} tag`,
          original: openTagStr
        };
      }
    }
  };

  parser.onclosetag = (tagName) => {
    // Get the closing tag string
    const closeTagStr = `</${tagName}>`;

    // Pop the matching open tag
    if (openTagStrings.length > 0) openTagStrings.pop();

    for (const tag of LLM_TAGS) {
      if (tag !== tagName && tagStates[tag].active) {
        tagStates[tag].content = (tagStates[tag].content || "") + closeTagStr;
      }
    }
    if (isLlmTag(tagName)) {
      // Mark tag as inactive
      tagStates[tagName].active = false;
    } else {
      // If no active tags, add to regular content
      if (!LLM_TAGS.some(tag => tagStates[tag].active)) {
        content += closeTagStr;
      }
    }
  };

  parser.ontext = (text) => {
    // Check if any tags are active
    const hasActiveTags = LLM_TAGS.some(tag => tagStates[tag].active);

    if (hasActiveTags) {
      // Add text to all active tags' content
      for (const tag of LLM_TAGS) {
        if (tagStates[tag].active) {
          tagStates[tag].content = (tagStates[tag].content || "") + text;
        }
      }
    } else {
      content += text;
    }
  };

  parser.onerror = () => {
    // If there's an error, just continue - we'll treat it as regular text
    parser.resume();
    content += currentText;
  };

  for await(const chunk of res) {
    if(chunk.usage) usage = chunk.usage.total_tokens;

    if(validationError !== null) break;

    if(chunk.choices[0]?.delta.content) {
      const tokens = chunk.choices[0].delta.content || "";
      currentText = tokens;


      try {
        parser.write(currentText);
      } catch (e) {
        // If parsing fails, treat it as normal text
        const currentlyActiveTag = LLM_TAGS.some(tag => tagStates[tag].active);

        if (currentlyActiveTag) {
          // Add text to all active tags' content
          for (const tag of LLM_TAGS) {
            if (tagStates[tag].active) {
              tagStates[tag].content = (tagStates[tag].content || "") + currentText;
            }
          }
        } else {
          // No active tags, this is regular content
          content += currentText;
        }
      }

      // Check if we're inside any special tags before handling the token
      const hasActiveTags = LLM_TAGS.some(tag => tagStates[tag].active);

      // If we're not inside any special tags, directly stream the token
      // This ensures tokens are streamed immediately when not in a tag
      if(!hasActiveTags) onTokens(tokens);

      if(validationError !== null) break;
    }
  }

  // Make sure to close the parser to flush any remaining data
  parser.close();

  // Calculate token usage delta from the previous total
  const tokenDelta = usage - totalTokens;
  totalTokens = usage;

  // Get content from each tag state
  const toolState = tagStates[TOOL_RUN_TAG];
  const editState = tagStates[EDIT_RUN_TAG];
  const diffSearchState = tagStates[DIFF_SEARCH_TAG];
  const diffReplaceState = tagStates[DIFF_REPLACE_TAG];

  // Check if we encountered any validation errors
  if (validationError !== null) {
    return history.concat([
      {
        role: "assistant-history",
        content,
        tokenUsage: tokenDelta,
      },
      {
        role: "tool-error",
        error: validationError.error,
        original: validationError.original,
      },
    ]);
  }

  // Check if we found a tool tag or edit tag
  if (toolState.content) {
    const parseResult = parseTool(`${openTag(TOOL_RUN_TAG)}${toolState.content}${closeTag(TOOL_RUN_TAG)}`);

    if(parseResult.status === "error") {
      return history.concat([
        {
          role: "assistant-history",
          content,
          tokenUsage: tokenDelta,
        },
        {
          role: "tool-error",
          error: parseResult.message,
          original: `${openTag(TOOL_RUN_TAG)}${toolState.content}${closeTag(TOOL_RUN_TAG)}`,
        },
      ]);
    }

    return history.concat([
      {
        role: "assistant-history",
        content,
        tokenUsage: tokenDelta,
      },
      {
        role: "tool",
        tool: parseResult.tool,
      },
    ]);
  }
  else if (editFilePath) {
    // Transform the edit tags into the appropriate tool call
    const parseResult = parseEditXML(
      editFileType,
      editFilePath,
      diffSearchState.content,
      diffReplaceState.content,
      editState.content || ""
    );

    if(parseResult.status === "error") {
      return history.concat([
        {
          role: "assistant-history",
          content,
          tokenUsage: tokenDelta,
        },
        {
          role: "tool-error",
          error: parseResult.message,
          original: `${openTag(EDIT_RUN_TAG)} filepath="${editFilePath}" type="${editFileType}"${editState.content}${closeTag(EDIT_RUN_TAG)}`,
        },
      ]);
    }

    return history.concat([
      {
        role: "assistant-history",
        content,
        tokenUsage: tokenDelta,
      },
      {
        role: "tool",
        tool: parseResult.tool,
      },
    ]);
  }

  return history.concat([
    {
      role: "assistant-history",
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
    if(item.role === "assistant-history") totalTokens += item.tokenUsage;
  }
  if(totalTokens <= MAX_CONTEXT_TOKENS) return { appliedWindow: false, history };

  const windowedHistory: HistoryItem[] = [];
  let runningTokens = 0;

  // Work backwards from the end of history up to the budget
  for (let i = history.length - 1; i >= 0; i--) {
    const item = history[i];

    if (item.role === "assistant-history") {
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

// Helper function to trim exactly one newline at start and end of content
function trimSingleNewline(content: string | undefined): string {
  if (!content) return "";
  return content.replace(/^\n/, '').replace(/\n$/, '');
}

function parseEditXML(
  editType: string | undefined,
  filePath: string | undefined,
  diffSearchContent: string | undefined,
  diffReplaceContent: string | undefined,
  editContent: string
): ParseToolResult {
  if (!filePath) {
    return {
      status: "error",
      message: "Missing filepath attribute in run-edit tag. Add filepath attribute to the run-edit tag."
    };
  }

  if (!editType) {
    return {
      status: "error",
      message: "Missing type attribute in run-edit tag. Add type attribute with one of: diff, append, prepend, create."
    };
  }

  // Trim single newlines from content
  const trimmedEditContent = trimSingleNewline(editContent);
  const trimmedDiffSearchContent = trimSingleNewline(diffSearchContent);
  const trimmedDiffReplaceContent = trimSingleNewline(diffReplaceContent);

  switch (editType) {
    case "diff":
      if (!diffSearchContent) {
        return {
          status: "error",
          message: "Missing diff-search content. Add a <diff-search> node inside <run-edit>"
        };
      }
      if (diffReplaceContent === undefined) {
        return {
          status: "error",
          message: "Missing diff-replace content. Add a <diff-replace> node inside <run-edit>"
        };
      }

      return {
        status: "success",
        tool: {
          type: "function",
          tool: {
            name: "edit",
            params: {
              filePath,
              edit: {
                type: "diff",
                search: trimmedDiffSearchContent,
                replace: trimmedDiffReplaceContent,
              }
            }
          }
        }
      };

    case "append":
      return {
        status: "success",
        tool: {
          type: "function",
          tool: {
            name: "edit",
            params: {
              filePath,
              edit: {
                type: "append",
                text: trimmedEditContent,
              }
            }
          }
        }
      };

    case "prepend":
      return {
        status: "success",
        tool: {
          type: "function",
          tool: {
            name: "edit",
            params: {
              filePath,
              edit: {
                type: "prepend",
                text: trimmedEditContent,
              }
            }
          }
        }
      };

    case "create":
      return {
        status: "success",
        tool: {
          type: "function",
          tool: {
            name: "create",
            params: {
              filePath,
              content: trimmedEditContent,
            }
          }
        }
      };

    default:
      return {
        status: "error",
        message: `Invalid edit type: ${editType}. Use one of: diff, append, prepend, create.`
      };
  }
}
