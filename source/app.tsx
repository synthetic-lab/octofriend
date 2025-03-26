import React, { useState, useCallback, useMemo } from "react";
import { Text, Box, Static } from "ink";
import TextInput from "ink-text-input";
import { t } from "structural";
import { Config, Metadata } from "./config.ts";
import OpenAI from "openai";
import {
  HistoryItem, UserMessage, AssistantMessage, ToolCallMessage, runAgent
} from "./llm.ts";
import Loading from "./loading.tsx";
import { Header } from "./header.tsx";
import { THEME_COLOR } from "./theme.ts";
import { runTool, BashToolSchema, ReadToolSchema } from "./tooldefs.ts";

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

type UiMode = "input" | "responding";

export default function App({ config, metadata }: Props) {
	const client = useMemo(() => {
		return new OpenAI({
			baseURL: config.baseUrl,
			apiKey: process.env[config.apiEnvVar],
		});
	}, [ config ]);

	const [ history, setHistory ] = useState<Array<HistoryItem>>([]);
	const [ query, setQuery ] = useState("");
	const [ mode, setMode ] = useState<UiMode>("input");

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
    setMode("responding");

		await runAgent(client, config, newHistory, setHistory, async (tool) => {
      return {
        role: "tool-output",
        content: await runTool(tool.tool),
      };
    });

    setMode("input");
	}, [ query, config, client ]);

  const staticItems: StaticItem[] = useMemo(() => {
    const settledHistory = mode === "responding" ? history.slice(0, history.length - 1) : history;
    return [
      { type: "header" },
      { type: "version", metadata, config },
      ...toStaticItems(settledHistory),
    ]
  }, [ history, mode ]);

  const lastHistoryItem = history[history.length - 1] || null;

	return <Box flexDirection="column" width="100%">
    <Static items={staticItems}>
      {
        (item, index) => <StaticItemRenderer item={item} key={`static-${index}`} />
      }
    </Static>

    {
      mode === "responding" && lastHistoryItem && <MessageDisplay item={lastHistoryItem} />
    }

    {
      mode === "responding" ? <Loading /> : <InputBox
        value={query}
        onChange={setQuery}
        onSubmit={onSubmit}
      />
    }
	</Box>
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
  switch(item.tool.tool.name) {
    case "read": return <ReadToolRenderer item={item.tool.tool} />
    case "bash": return <BashToolRenderer item={item.tool.tool} />
  }
}

function BashToolRenderer({ item }: { item: t.GetType<typeof BashToolSchema> }) {
  return <Box>
		<Text color="gray">{item.name}: </Text>
		<Text color={THEME_COLOR}>{item.params.cmd}</Text>
	</Box>
}

function ReadToolRenderer({ item }: { item: t.GetType<typeof ReadToolSchema> }) {
  return <Box>
		<Text color="gray">{item.name}: </Text>
		<Text color={THEME_COLOR}>{item.params.filePath}</Text>
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
	value: string,
	onChange: (s: string) => any,
	onSubmit: () => any,
}) => {
  return <Box width="100%" borderStyle="round" borderColor={THEME_COLOR}>
    <TextInput value={props.value} onChange={props.onChange} onSubmit={props.onSubmit} />
  </Box>
});
