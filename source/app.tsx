import React, { useState, useCallback, useMemo } from "react";
import { Text, Box, Static } from "ink";
import TextInput from "ink-text-input";
import { Config, Metadata } from "./config.ts";
import OpenAI from "openai";
import { exec } from "child_process";
import { promisify } from "util";
import { t } from "structural";
import {
  LlmMessage, UserMessage, AssistantMessage, ToolCallRequestSchema, SYSTEM_PROMPT
} from "./llm.ts";
import Loading from "./loading.tsx";
import { Header } from "./header.tsx";
import { THEME_COLOR } from "./theme.ts";

const execPromise = promisify(exec);

type Props = {
	config: Config;
	metadata: Metadata,
};

type ToolCallMessage = {
	role: "tool",
	tool: t.GetType<typeof ToolCallRequestSchema>,
};

type ToolOutputMessage = {
	role: "tool-output",
	content: string,
};

type HistoryItem = UserMessage | AssistantMessage | ToolCallMessage | ToolOutputMessage;

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

type StaticItem = {
  type: "header",
} | {
  type: "version",
  metadata: Metadata,
  config: Config,
} | {
  type: "history-item",
  item: HistoryItem,
};

function toStaticItems(messages: HistoryItem[]): Array<StaticItem> {
  return messages.map(message => ({
    type: "history-item",
    item: message,
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
        setHistory([ ...newHistory ]);

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
        setHistory([ ...newHistory ]);

				await getResponse();
			}
		}

		await getResponse();

		setResponding(false);
	}, [ setQuery, query, config, runBashCommand, client ]);

  const staticItems: StaticItem[] = useMemo(() => [
    { type: "header" },
    { type: "version", metadata, config },
    ...toStaticItems(history.slice(0, history.length - 1)),
  ], [ history ]);

  const lastHistoryItem = history[history.length - 1] || null;

	return <Box flexDirection="column" width="100%">
    <Static items={staticItems}>
      {
        (item, index) => <StaticItemRenderer item={item} key={`static-${index}`} />
      }
    </Static>

    {
      lastHistoryItem && <MessageDisplay item={lastHistoryItem} />
    }

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

const StaticItemRenderer = React.memo(({ item }: { item: StaticItem }) => {
  if(item.type === "header") return <Header />;
  if(item.type === "version") {
    return <Box marginTop={1} marginLeft={1} flexDirection="column">
      <Text color="gray">
        Model: {item.config.model}
      </Text>
      <Text color="gray">
        Version: {item.metadata.version}
      </Text>
      <Box marginTop={1}>
        <Text>
          Octo is your friend. Tell Octo <Text color={THEME_COLOR}>what you want to do.</Text>
        </Text>
      </Box>
    </Box>
  }

  return <MessageDisplay item={item.item} />
});

const MessageDisplay = React.memo(({ item }: { item: HistoryItem }) => {
  return <Box marginTop={1} marginBottom={1} flexDirection="column">
    <MessageDisplayInner item={item} />
  </Box>
});

const MessageDisplayInner = React.memo(({ item }: { item: HistoryItem }) => {
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
