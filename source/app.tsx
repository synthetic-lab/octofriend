import React, { useState, useCallback, useMemo, useEffect } from "react";
import { Text, Box } from "ink";
import TextInput from "ink-text-input";
import { Config, Metadata } from "./config.ts";
import OpenAI from "openai";
import figlet from "figlet";
import Spinner from "ink-spinner";
import { exec } from "child_process";
import { promisify } from "util";
import { t, toTypescript } from "structural";

const execPromise = promisify(exec);

const THEME_COLOR = "#72946d";

type Props = {
	config: Config;
	metadata: Metadata,
};

type UserMessage = {
	role: "user";
	content: string;
};

type AssistantMessage = {
	role: "assistant";
	content: string;
};

const ToolCallSchema = t.subtype({
	name: t.value("bash"),
	params: t.subtype({
		cmd: t.str.comment("The command to run"),
	}),
}).comment("Runs a bash command in the cwd");

const ToolCallRequestSchema = t.subtype({
	type: t.value("function"),
	tool: ToolCallSchema,
});

type ToolCallMessage = {
	role: "tool",
	tool: t.GetType<typeof ToolCallRequestSchema>,
};

type ToolOutputMessage = {
	role: "tool-output",
	content: string,
};

type SystemPrompt = {
	role: "system",
	content: string,
};

type HistoryItem = UserMessage | AssistantMessage | ToolCallMessage | ToolOutputMessage;
type LlmMessage = SystemPrompt | UserMessage | AssistantMessage;

const SYSTEM_PROMPT = `
You are a coding assistant called Octo. You have access to the following tools, defined as
TypeScript types:

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

Note that you can only call one tool at a time: you can't call multiple.
`.trim();

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

export default function App({ config, metadata }: Props) {
	const client = useMemo(() => {
		return new OpenAI({
			baseURL: config.baseUrl,
			apiKey: process.env[config.apiEnvVar],
		});
	}, [ config ]);

	const [ history, setHistory ] = useState<Array<HistoryItem>>([]);
	const [ query, setQuery ] = useState("");
	const [ responding, setResponding ] = useState(false);

	const runBashCommand = useCallback(async (command: string) => {
		const { stdout, stderr } = await execPromise(command, { cwd: process.cwd() });
		return stdout || stderr;
	}, []);

	const onSubmit = useCallback(async () => {
		setQuery("");
		const userMessage: UserMessage = {
			role: "user",
			content: query,
		};

		let newHistory = [
			...history,
			userMessage,
		];

		setHistory(newHistory);
		setResponding(true);

		async function getResponse() {
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
					newHistory.push({ ...last, content });
					setHistory([ ...newHistory ]);
					return;
				}

				newHistory.push({
					role: "tool",
					tool,
				});

				try {
					const result = await runBashCommand(tool.tool.params.cmd);
					newHistory.push({
						role: "tool-output",
						content: result,
					});
				} catch(e) {
					newHistory.push({
						role: "user",
						content: `Error: ${e}`,
					});
				}

				await getResponse();
			}
		}

		await getResponse();

		setResponding(false);
	}, [ setQuery, query, config, runBashCommand, client ]);

	return <Box flexDirection="column" width="100%">
		<Header />

		<Box marginTop={1} marginLeft={1} flexDirection="column">
			<Text color="gray">
				Model: {config.model}
			</Text>
			<Text color="gray">
				Version: {metadata.version}
			</Text>
			<Box marginTop={1}>
				<Text>
					Octo is your friend. Tell Octo <Text color={THEME_COLOR}>what you want to do.</Text>
				</Text>
			</Box>
		</Box>

		<History history={history} />

		<InputBox
			responding={responding}
			value={query}
			onChange={setQuery}
			onSubmit={onSubmit}
		/>
	</Box>
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

const History = React.memo(({ history }: {
	history: Array<HistoryItem>,
}) => {
	return <Box flexDirection="column">
		{
			history.map((item, index) => {
				return <Box marginTop={1} marginBottom={1} flexDirection="column" key={`msg-${index}`}>
					<MessageDisplay item={item} />
				</Box>
			})
		}
	</Box>
});

const MessageDisplay = React.memo(({ item }: { item: HistoryItem }) => {
	if(item.role === "assistant") return <AssistantMessage item={item} />
	if(item.role === "tool") return <ToolMessage item={item} />
	if(item.role === "tool-output") {
		return <Text color="gray">
			Got <Text>{item.content.split("\n").length}</Text> lines of output
		</Text>
	}
	return <Text>
		{ ">" } {item.content}
	</Text>
});

function ToolMessage({ item }: { item: ToolCallMessage }) {
	return <Box>
		<Text color="gray">{item.tool.tool.name}: </Text>
		<Text color={THEME_COLOR}>{item.tool.tool.params.cmd}</Text>
	</Box>
}

function AssistantMessage({ item }: { item: AssistantMessage }) {
	return <Text color="white">{item.content}</Text>
}

const InputBox = React.memo((props: {
	responding: boolean,
	value: string,
	onChange: (s: string) => any,
	onSubmit: () => any,
}) => {
		if(props.responding) return <Loading />;
		return <Box width="100%" borderStyle="round" borderColor={THEME_COLOR}>
			<TextInput value={props.value} onChange={props.onChange} onSubmit={props.onSubmit} />
		</Box>
});

const Header = React.memo(() => {
	const font: figlet.Fonts = "Delta Corps Priest 1";
	const top = figlet.textSync("Octo", font);
	const bottom = figlet.textSync("Friend", font);

	return <Box flexDirection="column">
		<Text color={THEME_COLOR}>{top}</Text>
		<Text>{bottom}</Text>
	</Box>
});

const LOADING_STRINGS = [
	"Scheming",
	"Plotting",
	"Manipulating",
	"Splashing",
	"Yearning",
	"Calculating",
];
function Loading() {
	const [ idx, setIndex ] = useState(0);
	const [ dotCount, setDotCount ] = useState(0);

	useEffect(() => {
		let fired = false;
		const timer = setTimeout(() => {
			fired = true;
			if(dotCount >= 3) {
				setDotCount(0);
				setIndex((idx + 1) % LOADING_STRINGS.length);
				return;
			}
			setDotCount(dotCount + 1);
		}, 300);

		return () => {
			if(!fired) clearTimeout(timer);
		}
	}, [ idx, dotCount ]);

	return <Box>
		<Text color="gray"><Spinner type="binary" /></Text>
		<Text>{ " " }</Text>
		<Text color={THEME_COLOR}>{LOADING_STRINGS[idx]}</Text><Text>{".".repeat(dotCount)}</Text>
	</Box>
}
