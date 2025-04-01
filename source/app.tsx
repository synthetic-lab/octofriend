import React, { useState, useCallback, useMemo, useEffect } from "react";
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
import {
  runTool,
  ToolError,
  BashToolSchema,
  ReadToolSchema,
  ListToolSchema,
  EditToolSchema,
  CreateToolSchema,
  AllEdits,
  DiffEdit,
  SKIP_CONFIRMATION,
} from "./tooldefs.ts";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import SelectInput from "ink-select-input";
import figures from "figures";
import { FileOutdatedError, fileTracker } from "./file-tracker.ts";

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

type RunArgs = {
  client: OpenAI,
  config: Config,
};
type UiState = {
  modeData: {
    mode: "input",
  } | {
    mode: "responding",
    inflightResponse: AssistantMessage,
  } | {
    mode: "tool-request",
    toolReq: ToolCallMessage["tool"],
  },
  history: Array<HistoryItem>,
  input: (args: RunArgs & { query: string }) => Promise<void>,
  runTool: (args: RunArgs & { toolReq: ToolCallMessage["tool"] }) => Promise<void>,
  rejectTool: () => void,
  _runAgent: (args: RunArgs) => Promise<void>,
};

const useAppStore = create<UiState>((set, get) => ({
  modeData: {
    mode: "input" as const,
  },
  history: [],
  running: false,

  input: async ({ client, config, query }) => {
    const userMessage: UserMessage = {
			role: "user",
			content: query,
		};

		let history = [
			...get().history,
			userMessage,
		];
    set({ history });
    await get()._runAgent({ client, config });
  },

  rejectTool: () => {
    set({
      history: [
        ...get().history,
        { role: "tool-reject" },
      ],
      modeData: {
        mode: "input",
      },
    });
  },

  runTool: async ({ client, config, toolReq }) => {
    try {
      const result = await runTool(toolReq.tool);
      const toolHistoryItem: HistoryItem = result.type === "output" ? {
        role: "tool-output",
        content: result.content,
      } : {
        role: "file-edit",
        content: result.content,
        sequence: result.sequence,
        path: result.path,
      };
      const history: HistoryItem[] = [
        ...get().history,
        toolHistoryItem,
      ];

      set({ history });
    } catch(e) {
      if(e instanceof ToolError) {
        const history: HistoryItem[] = [
          ...get().history,
          {
            role: "tool-error",
            error: e.message,
          },
        ];

        set({ history });
      }
      if(e instanceof FileOutdatedError) {
        const history: HistoryItem[] = [
          ...get().history,
          {
            role: "file-outdated",
            updatedFile: await fileTracker.read(e.filePath),
          },
        ];

        set({ history });
      }
      else {
        throw e;
      }
    }

    await get()._runAgent({ client, config });
  },

  _runAgent: async ({ client, config }) => {
    let content = "";
    set({
      modeData: {
        mode: "responding",
        inflightResponse: {
          role: "assistant",
          content,
        },
      }
    });

		const history = await runAgent(client, config, get().history, tokens => {
      content += tokens;
      set({
        modeData: {
          mode: "responding",
          inflightResponse: {
            role: "assistant",
            content,
          },
        },
      });
    });


    const lastHistoryItem = history[history.length - 1];
    if(lastHistoryItem.role === "assistant") {
      set({ modeData: { mode: "input" }, history });
      return;
    }
    if(lastHistoryItem.role === "tool-error") {
      set({ history });
      return get()._runAgent({ client, config });
    }

    if(lastHistoryItem.role !== "tool") {
      throw new Error(`Unexpected role: ${lastHistoryItem.role}`);
    }

    set({
      modeData: {
        mode: "tool-request",
        toolReq: lastHistoryItem.tool,
      },
      history,
    });
  },
}));

export default function App({ config, metadata }: Props) {
	const client = useMemo(() => {
		return new OpenAI({
			baseURL: config.baseUrl,
			apiKey: process.env[config.apiEnvVar],
		});
	}, [ config ]);

  const { history, modeData } = useAppStore(
    useShallow(state => ({
      history: state.history,
      modeData: state.modeData,
    }))
  );

  const staticItems: StaticItem[] = useMemo(() => {
    return [
      { type: "header" },
      { type: "version", metadata, config },
      ...toStaticItems(history),
    ]
  }, [ history ]);

	return <Box flexDirection="column" width="100%" height="100%">
    <Static items={staticItems}>
      {
        (item, index) => <StaticItemRenderer item={item} key={`static-${index}`} />
      }
    </Static>

    {
      modeData.mode === "responding" &&
        modeData.inflightResponse.content &&
        <MessageDisplay item={modeData.inflightResponse} />
    }

    <BottomBar client={client} config={config} />
	</Box>
}

function BottomBar({ config, client }: { config: Config, client: OpenAI }) {
	const [ query, setQuery ] = useState("");
  const { modeData, input } = useAppStore(
    useShallow(state => ({
      modeData: state.modeData,
      input: state.input,
    }))
  );

	const onSubmit = useCallback(async () => {
		setQuery("");
    await input({ query, config, client });
	}, [ query, config, client ]);

  if(modeData.mode === "responding") return <Loading />;

  if(modeData.mode === "tool-request") {
    return <ToolRequestRenderer
      toolReq={modeData.toolReq}
      client={client}
      config={config}
    />;
  }

  return <InputBox
    value={query}
    onChange={setQuery}
    onSubmit={onSubmit}
  />;
}

function ToolRequestRenderer({ toolReq, client, config }: {
  toolReq: ToolCallMessage["tool"]
} & RunArgs) {
  const { runTool, rejectTool } = useAppStore(
    useShallow(state => ({
      runTool: state.runTool,
      rejectTool: state.rejectTool,
    }))
  );

  const items = [
    {
      label: "Yes",
      value: "yes",
    },
    {
      label: "No, and tell Octo what to do differently",
      value: "no",
    },
  ];

	const onSelect = useCallback(async (item: (typeof items)[number]) => {
    if(item.value === "no") rejectTool();
    else await runTool({ toolReq, config, client });
	}, [ toolReq, config, client ]);

  useEffect(() => {
    if(SKIP_CONFIRMATION.includes(toolReq.tool.name)) runTool({ toolReq, config, client });
  }, [ toolReq ]);

  if(SKIP_CONFIRMATION.includes(toolReq.tool.name)) {
    return <Loading />;
  }

  return <SelectInput
    items={items}
    onSelect={onSelect}
    indicatorComponent={IndicatorComponent}
    itemComponent={ItemComponent}
  />
}

function IndicatorComponent({ isSelected = false }: { isSelected?: boolean }) {
  return <Box marginRight={1}>
    {
      isSelected ? <Text color={THEME_COLOR}>{figures.pointer}</Text> : <Text> </Text>
    }
  </Box>
}

function ItemComponent({ isSelected = false, label }: { isSelected?: boolean, label: string }) {
  return <Text color={isSelected ? THEME_COLOR : undefined}>{label}</Text>
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
	if(item.role === "tool-output" || item.role === "file-edit") {
		return <Text color="gray">
			Got <Text>{item.content.split("\n").length}</Text> lines of output
		</Text>
	}
  if(item.role === "tool-error") {
    return <Text color="red">
      Error: {item.error}
    </Text>
  }
  if(item.role === "tool-reject") {
    return <Text>
      Tool rejected; tell Octo what to do instead:
    </Text>
  }
  if(item.role === "file-outdated") {
    return <Box flexDirection="column">
      <Text>File was modified since it was last read; re-reading...</Text>
      <Text color="gray">
        Got {item.updatedFile.split("\n").length} lines of output
      </Text>
    </Box>
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
    case "list": return <ListToolRenderer item={item.tool.tool} />
    case "bash": return <BashToolRenderer item={item.tool.tool} />
    case "edit": return <EditToolRenderer item={item.tool.tool} />
    case "create": return <CreateToolRenderer item={item.tool.tool} />
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

function ListToolRenderer({ item }: { item: t.GetType<typeof ListToolSchema> }) {
  return <Box>
		<Text color="gray">{item.name}: </Text>
		<Text color={THEME_COLOR}>{item.params.dirPath || process.cwd()}</Text>
	</Box>
}

function EditToolRenderer({ item }: { item: t.GetType<typeof EditToolSchema> }) {
  return <Box flexDirection="column">
    <Box>
      <Text>Edit: </Text>
      <Text color={THEME_COLOR}>{item.params.filePath}</Text>
    </Box>
    <EditRenderer item={item.params.edit} />
  </Box>
}

function EditRenderer({ item }: { item: t.GetType<typeof AllEdits> }) {
  switch(item.type) {
    case "diff": return <DiffEditRenderer item={item} />
    case "append":
      return <Box flexDirection="column">
        <Text>Octo wants to add the following to the end of the file:</Text>
        <Text>{item.text}</Text>
      </Box>
    case "prepend":
      return <Box flexDirection="column">
        <Text>Octo wants to add the following to the beginning of the file:</Text>
        <Text>{item.text}</Text>
      </Box>
  }
}

function DiffEditRenderer({ item }: { item: t.GetType<typeof DiffEdit> }) {
  return <Box flexDirection="column">
    <Text>Octo wants to replace the following:</Text>
    <Text color="gray">Original text:</Text>
    <Text color="gray">{item.search}</Text>
    <Text>New:</Text>
    <Text>{item.replace}</Text>
  </Box>
}

function CreateToolRenderer({ item }: { item: t.GetType<typeof CreateToolSchema> }) {
  return <Box flexDirection="column">
    <Box>
      <Text>Create file: </Text>
      <Text color={THEME_COLOR}>{item.params.filePath}</Text>
    </Box>
    <Box flexDirection="column">
      <Text>With content:</Text>
      <Text>{item.params.content}</Text>
    </Box>
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
