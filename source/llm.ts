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

export const SYSTEM_PROMPT = `
You are a coding assistant called Octo, also known as octofriend. You have access to the following
tools, defined as TypeScript types:

${toTypescript(ToolCallSchema)}

You can call them by responding with JSON of the following type:

{ type: "function", tool: SOME_TOOL }

For example:

${JSON.stringify({
	type: "function",
	tool: {
		name: "bash",
		params: {
			cmd: "ls -la",
		},
	},
} satisfies t.GetType<typeof ToolCallRequestSchema>)}

You don't have to call any tool functions if you don't need to; you can also just chat to the user
normally. Attempt to determine what your current task is (the user may have told you outright),
and figure out the state of the repo using your tools. Then, help the user with the task.

You may need to use tools again after some back-and-forth with the user, as they help you refine
your solution.

If you want to call a tool, respond ONLY with JSON: no other text. Do not wrap it in backticks or
use Markdown. For example, do NOT do this:

\`\`\`json
${JSON.stringify({
	type: "function",
	tool: {
		name: "bash",
		params: {
			cmd: "ls -la",
		},
	},
} satisfies t.GetType<typeof ToolCallRequestSchema>)}
\`\`\`

Instead, simply respond with this:

${JSON.stringify({
	type: "function",
	tool: {
		name: "bash",
		params: {
			cmd: "ls -la",
		},
	},
} satisfies t.GetType<typeof ToolCallRequestSchema>)}

Note that you can only call one tool at a time: you can't call multiple. You also can't talk if you
want to call a tool: you can only respond with the single JSON object.
`.trim();

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
	const output: LlmMessage[] = [
		{
			role: "system",
			content: SYSTEM_PROMPT,
		},
	];

	return output.concat(messages.map(message => {
		if(message.role === "tool") {
			return {
				role: "assistant",
				content: JSON.stringify(message.tool),
			};
		}
		if(message.role === "tool-output") {
			return {
				role: "user",
				content: message.content,
			};
		}
		return message;
	}));
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

  let isJson = false;
  let content = "";
  for await(const chunk of res) {
    if (chunk.choices[0]?.delta.content) {
      const tokens = chunk.choices[0].delta.content || "";
      content += tokens;

      if(!isJson && content.trimStart().startsWith("{")) isJson = true;
      if(isJson) continue;

      newHistory = [...newHistory];
      const last = newHistory.pop() as AssistantMessage;
      newHistory.push({
        ...last, content,
      } satisfies AssistantMessage);
      setHistory(newHistory);
    }
  }

  if(isJson) {
    const last = newHistory.pop() as AssistantMessage;
    const tool = parseTool(content);
    if(tool == null) {
      // TODO we should have unambiguous tool call syntax and throw errors here
      newHistory.push({ ...last, content });
      setHistory([ ...newHistory ]);
      return;
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

    await runAgent(client, config, newHistory, setHistory, runTool);
  }
}

function parseTool(content: string) {
	try {
		const json = JSON.parse(content);
		const tool = ToolCallRequestSchema.slice(json);
		return tool;
	} catch {
		return null;
	}
}
