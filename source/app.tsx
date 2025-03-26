import React, { useState, useCallback, useMemo } from "react";
import { Text, Box, Static } from "ink";
import TextInput from "ink-text-input";
import { Config, Metadata } from "./config.ts";
import OpenAI from "openai";
import { exec } from "child_process";
import { promisify } from "util";
import {
  HistoryItem, UserMessage, AssistantMessage, ToolCallMessage, runAgent
} from "./llm.ts";
import Loading from "./loading.tsx";
import { Header } from "./header.tsx";
import { THEME_COLOR } from "./theme.ts";

const execPromise = promisify(exec);

type Props = {
	config: Config;
	metadata: Metadata,
};

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

		await runAgent(client, config, newHistory, setHistory, async (tool) => {
      return {
        role: "tool-output",
        content: await runBashCommand(tool.tool.params.cmd),
      };
    });

		setResponding(false);
	}, [ query, config, client ]);

  const staticItems: StaticItem[] = useMemo(() => {
    const settledHistory = responding ? history.slice(0, history.length - 1) : history;
    return [
      { type: "header" },
      { type: "version", metadata, config },
      ...toStaticItems(settledHistory),
    ]
  }, [ history, responding ]);

  const lastHistoryItem = history[history.length - 1] || null;

	return <Box flexDirection="column" width="100%">
    <Static items={staticItems}>
      {
        (item, index) => <StaticItemRenderer item={item} key={`static-${index}`} />
      }
    </Static>

    {
      responding && lastHistoryItem && <MessageDisplay item={lastHistoryItem} />
    }

		<InputBox
			responding={responding}
			value={query}
			onChange={setQuery}
			onSubmit={onSubmit}
		/>
	</Box>
}

async function runBashCommand(command: string) {
  const { stdout, stderr } = await execPromise(command, { cwd: process.cwd() });
  return stdout || stderr;
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
  return <Box marginTop={1} marginBottom={1} flexDirection="column" paddingRight={4}>
    <MessageDisplayInner item={item} />
  </Box>
});

const MessageDisplayInner = React.memo(({ item }: { item: HistoryItem }) => {
	if(item.role === "assistant") return <AssistantMessageRenderer item={item} />
	if(item.role === "tool") return <ToolMessageRenderer item={item} />
	if(item.role === "tool-output") {
		return <Text color="gray">
			Got <Text>{item.content.split("\n").length}</Text> lines of output
		</Text>
	}
	return <Box>
    <Box marginRight={1}>
      <Text color="white">
        ▶
      </Text>
    </Box>
    <Text>
      {item.content}
    </Text>
  </Box>
});

function ToolMessageRenderer({ item }: { item: ToolCallMessage }) {
	return <Box>
		<Text color="gray">{item.tool.tool.name}: </Text>
		<Text color={THEME_COLOR}>{item.tool.tool.params.cmd}</Text>
	</Box>
}

function AssistantMessageRenderer({ item }: { item: AssistantMessage }) {
	return <Box>
    <Box marginRight={1} width={2} flexShrink={0} flexGrow={0}><Text>🐙</Text></Box>
    <Box flexGrow={1}>
      <Text>{item.content}</Text>
    </Box>
  </Box>
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
