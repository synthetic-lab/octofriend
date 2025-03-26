import OpenAI from "openai";
import { t, toTypescript } from "structural";
import { Config } from "./config.ts";

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

const TOOL_OPEN_TAG = "<x-octo-tool>";
const TOOL_CLOSE_TAG = "</x-octo-tool>";
const TOOL_RESPONSE_OPEN_TAG = "<x-octo-tool-output>";
const TOOL_RESPONSE_CLOSE_TAG = "</x-octo-tool-output>";

export const ToolCallSchema = t.subtype({
	name: t.value("bash"),
	params: t.subtype({
		cmd: t.str.comment("The command to run"),
	}),
}).comment("Runs a bash command in the cwd");

export const ToolCallRequestSchema = t.subtype({
	type: t.value("function"),
	tool: ToolCallSchema,
});

const TOOL_CALL_INSTRUCTIONS = `
You have access to the following tools, defined as TypeScript types:

${toTypescript(ToolCallSchema)}

You can call them by responding with JSON of the following type inside special XML tags:

${TOOL_OPEN_TAG}{"type":"function","tool":SOME_TOOL}${TOOL_CLOSE_TAG}

For example:

${TOOL_OPEN_TAG}${JSON.stringify({
	type: "function",
	tool: {
		name: "bash",
		params: {
			cmd: "ls -la",
		},
	},
} satisfies t.GetType<typeof ToolCallRequestSchema>)}${TOOL_CLOSE_TAG}

You don't have to call any tool functions if you don't need to; you can also just chat to the user
normally. Attempt to determine what your current task is (the user may have told you outright),
and figure out the state of the repo using your tools. Then, help the user with the task.

You may need to use tools again after some back-and-forth with the user, as they help you refine
your solution.

NEVER output the ${TOOL_OPEN_TAG} or ${TOOL_CLOSE_TAG} unless you intend to call a tool. If you just
intend to talk about them, leave out the x- part of the tags. These tags will be parsed out of your
response by an automated system, and it can't differentiate between you using the tag, and just
talking about the tag; it will assume any use of the tag is an attempt to call a tool.

Your tool calls should be the LAST thing in your response, if you have any tool calls.
Don't wrap them in backticks Markdown-style, just write the raw tags out.

Remember, you don't need to use tools! Only use them when appropriate.
`.trim();

function systemPrompt() {
return `
You are a coding assistant called Octo, also known as octofriend.

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

export type HistoryItem = UserMessage | AssistantMessage | ToolCallMessage | ToolOutputMessage;

function toLlmMessages(messages: HistoryItem[]): Array<LlmMessage> {
	let output: LlmMessage[] = [
		{
			role: "system",
			content: systemPrompt(),
		},
	];

	output = output.concat(messages.map(message => {
		if(message.role === "tool") {
			return {
				role: "assistant",
				content: TOOL_OPEN_TAG + JSON.stringify(message.tool) + TOOL_CLOSE_TAG,
			};
		}
		if(message.role === "tool-output") {
			return {
				role: "user",
				content: TOOL_RESPONSE_OPEN_TAG + message.content + TOOL_RESPONSE_CLOSE_TAG,
			};
		}
		return message;
	}));

  const last = messages[messages.length - 1];
  if(last && last.role === "user") {
    output.pop();
    output.push({
      role: "user",
      content: last.content + "\n" + TOOL_CALL_INSTRUCTIONS,
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

export async function runAgent(
  client: OpenAI,
  config: Config,
  history: HistoryItem[],
  setHistory: (h: HistoryItem[]) => any,
  runTool: (tool: ToolCallMessage["tool"]) => Promise<ToolOutputMessage>,
) {
  let newHistory = [ ...history ];

  const res = await client.chat.completions.create({
    model: config.model,
    messages: toLlmMessages(newHistory),
    stream: true,
  });

  const assistantMessage: AssistantMessage = {
    role: "assistant",
    content: "",
  };

  newHistory.push(assistantMessage);

  let maybeTool = false;
  let unclosedToolTag = false;
  let content = "";
  let toolContent = "";
  const toolTags: string[] = [];

  for await(const chunk of res) {
    if (chunk.choices[0]?.delta.content) {
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

        // Parse out tool tags
        while(toolContent.includes(TOOL_OPEN_TAG)) {
          unclosedToolTag = true;
          const closeIndex = toolContent.indexOf(TOOL_CLOSE_TAG);
          if(closeIndex < 0) break;
          unclosedToolTag = false;

          // TODO: actually immediately run this, and split up the assistant vs tool call message
          toolTags.push(toolContent.slice(0, closeIndex + TOOL_CLOSE_TAG.length));
          toolContent = toolContent.slice(closeIndex + TOOL_CLOSE_TAG.length).trimStart();
        }

        if(!unclosedToolTag) {
          // Check any remaining characters: do they match so far?
          for(let i = 0; i < toolContent.length && i < TOOL_OPEN_TAG.length; i++) {
            if(toolContent[i] !== TOOL_OPEN_TAG[i]) {
              maybeTool = false;
              content += toolContent;
              toolContent = "";
              break;
            }
          }
        }
      }

      if(!maybeTool) {
        content += tokens;
        newHistory = [...newHistory];
        const last = newHistory.pop() as AssistantMessage;
        newHistory.push({
          ...last, content,
        } satisfies AssistantMessage);
        setHistory(newHistory);
      }
    }
  }

  if(toolTags.length > 0) {
    for(const tag of toolTags) {
      const tool = parseTool(tag);
      if(tool == null) {
        // TODO tell the LLM it fucked up
        throw new Error('wat');
      }

      newHistory.push({
        role: "tool",
        tool,
      });
      setHistory([ ...newHistory ]);

      try {
        const result = await runTool(tool);
        newHistory.push(result);
      } catch(e) {
        newHistory.push({
          role: "user",
          content: `Error: ${e}`,
        });
      }
      setHistory([ ...newHistory ]);
    }

    await runAgent(client, config, newHistory, setHistory, runTool);
  }
}

function parseTool(tag: string) {
  const content = tag.replace(TOOL_OPEN_TAG, "").replace(TOOL_CLOSE_TAG, "").trim();
	try {
		const json = JSON.parse(content);
		const tool = ToolCallRequestSchema.slice(json);
		return tool;
	} catch {
		return null;
	}
}
