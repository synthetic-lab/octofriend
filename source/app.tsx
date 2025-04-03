import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Text, Box, Static, measureElement, DOMElement } from "ink";
import TextInput from "ink-text-input";
import { t } from "structural";
import { Config, Metadata } from "./config.ts";
import OpenAI from "openai";
import { runAgent, TOOL_RUN_TAG } from "./llm.ts";
import { HistoryItem, UserItem, AssistantItem, ToolCallItem } from "./history.ts";
import { tagged } from "./xml.ts";
import Loading from "./loading.tsx";
import { Header } from "./header.tsx";
import { THEME_COLOR } from "./theme.ts";
import {
  runTool,
  validateTool,
  ToolError,
  bash,
  read,
  list,
  edit,
  create as createTool,
  SKIP_CONFIRMATION,
} from "./tools/index.ts";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import SelectInput from "ink-select-input";
import figures from "figures";
import { FileOutdatedError, fileTracker } from "./tools/file-tracker.ts";

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
    inflightResponse: AssistantItem,
  } | {
    mode: "tool-request",
    toolReq: ToolCallItem["tool"],
  } | {
    mode: "error-recovery",
  },
  history: Array<HistoryItem>,
  input: (args: RunArgs & { query: string }) => Promise<void>,
  runTool: (args: RunArgs & { toolReq: ToolCallItem["tool"] }) => Promise<void>,
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
    const userMessage: UserItem = {
			type: "user",
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
        { type: "tool-reject" },
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
        type: "tool-output",
        content: result.content,
      } : {
        type: "file-edit",
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
      const history = [
        ...get().history,
        await tryTransformToolError(toolReq, e),
      ];
      set({ history });
    }

    await get()._runAgent({ client, config });
  },

  _runAgent: async ({ client, config }) => {
    let content = "";
    set({
      modeData: {
        mode: "responding",
        inflightResponse: {
          type: "assistant",
          content,
          tokenUsage: 0, // Will be updated with actual value after completion
        },
      }
    });

    const debounceTimeout = 16;
    let timeout: NodeJS.Timeout | null = null;
    let lastContent = "";

    const history = await runAgent(client, config, get().history, tokens => {
      content += tokens;

      // Skip duplicate updates
      if (content === lastContent) return;
      lastContent = content;

      if (timeout) return;

      // Schedule the UI update
      timeout = setTimeout(() => {
        set({
          modeData: {
            mode: "responding",
            inflightResponse: {
              type: "assistant",
              content,
              tokenUsage: 0, // Will be updated with actual value after completion
            },
          },
        });

        timeout = null;
      }, debounceTimeout);
    });
    if(timeout) clearTimeout(timeout);

    const lastHistoryItem = history[history.length - 1];
    if(lastHistoryItem.type === "assistant") {
      set({ modeData: { mode: "input" }, history });
      return;
    }
    if(lastHistoryItem.type === "tool-error") {
      set({
        modeData: { mode: "error-recovery" },
        history
      });
      return get()._runAgent({ client, config });
    }

    if(lastHistoryItem.type !== "tool") {
      throw new Error(`Unexpected role: ${lastHistoryItem.type}`);
    }

    try {
      await validateTool(lastHistoryItem.tool.tool);
    } catch(e) {
      set({
        modeData: {
          mode: "error-recovery",
        },
        history: [
          ...history,
          await tryTransformToolError(lastHistoryItem.tool, e),
        ],
      });
      return await get()._runAgent({ client, config });
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

async function tryTransformToolError(
  toolReq: ToolCallItem["tool"], e: unknown
): Promise<HistoryItem> {
  if(e instanceof ToolError) {
    return {
      type: "tool-error",
      error: e.message,
      original: tagged(TOOL_RUN_TAG, {}, JSON.stringify(toolReq.tool)),
    };
  }
  if(e instanceof FileOutdatedError) {
    return {
      type: "file-outdated",
      updatedFile: await fileTracker.read(e.filePath),
    };
  }
  throw e;
}

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

    <BottomBar client={client} config={config} metadata={metadata} />
	</Box>
}

function BottomBar({ config, client, metadata }: {
  config: Config,
  client: OpenAI,
  metadata: Metadata,
}) {
  const [ versionCheck, setVersionCheck ] = useState("Checking for updates...");

  useEffect(() => {
    getLatestVersion().then(latestVersion => {
      if(latestVersion && metadata.version < latestVersion) {
        setVersionCheck("New version released! Run npm install -g octofriend to update.");
        return;
      }
      setVersionCheck("Octo is up-to-date.");
      setTimeout(() => {
        setVersionCheck("");
      }, 5000);
    });
  }, [ metadata ]);

  return <Box flexDirection="column" width="100%">
    <BottomBarContent config={config} client={client} />
    <Box
      width="100%"
      justifyContent="flex-end"
      height={1}
      flexShrink={0}
      flexGrow={1}
    >
      <Text color={THEME_COLOR}>{versionCheck}</Text>
    </Box>
  </Box>
}

const PackageSchema = t.subtype({
  "dist-tags": t.subtype({
    latest: t.str,
  }),
});
async function getLatestVersion() {
  try {
    const response = await fetch("https://registry.npmjs.com/octofriend");
    const contents = await response.json();
    const packageInfo = PackageSchema.slice(contents);
    return packageInfo["dist-tags"].latest;
  } catch {
    return null;
  }
}

function BottomBarContent({ config, client }: { config: Config, client: OpenAI }) {
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
  if(modeData.mode === "error-recovery") return <Loading />;

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
  toolReq: ToolCallItem["tool"]
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
	if(item.type === "assistant") return <AssistantMessageRenderer item={item} />
	if(item.type === "tool") return <ToolMessageRenderer item={item} />
	if(item.type === "tool-output" || item.type === "file-edit") {
		return <Text color="gray">
			Got <Text>{item.content.split("\n").length}</Text> lines of output
		</Text>
	}
  if(item.type === "tool-error") {
    return <Text color="red">
      Error: {item.error}
    </Text>
  }
  if(item.type === "tool-reject") {
    return <Text>
      Tool rejected; tell Octo what to do instead:
    </Text>
  }
  if(item.type === "file-outdated") {
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

function ToolMessageRenderer({ item }: { item: ToolCallItem }) {
  switch(item.tool.tool.name) {
    case "read": return <ReadToolRenderer item={item.tool.tool} />
    case "list": return <ListToolRenderer item={item.tool.tool} />
    case "bash": return <BashToolRenderer item={item.tool.tool} />
    case "edit": return <EditToolRenderer item={item.tool.tool} />
    case "create": return <CreateToolRenderer item={item.tool.tool} />
  }
}

function BashToolRenderer({ item }: { item: t.GetType<typeof bash.Schema> }) {
  return <Box flexDirection="column">
    <Box>
      <Text color="gray">{item.name}: </Text>
      <Text color={THEME_COLOR}>{item.params.cmd}</Text>
    </Box>
		<Text color="gray">timeout: {item.params.timeout}</Text>
	</Box>
}

function ReadToolRenderer({ item }: { item: t.GetType<typeof read.Schema> }) {
  return <Box>
		<Text color="gray">{item.name}: </Text>
		<Text color={THEME_COLOR}>{item.params.filePath}</Text>
	</Box>
}

function ListToolRenderer({ item }: { item: t.GetType<typeof list.Schema> }) {
  return <Box>
		<Text color="gray">{item.name}: </Text>
		<Text color={THEME_COLOR}>{item?.params?.dirPath || process.cwd()}</Text>
	</Box>
}

function EditToolRenderer({ item }: { item: t.GetType<typeof edit.Schema> }) {
  return <Box flexDirection="column">
    <Box>
      <Text>Edit: </Text>
      <Text color={THEME_COLOR}>{item.params.filePath}</Text>
    </Box>
    <EditRenderer item={item.params.edit} />
  </Box>
}

function EditRenderer({ item }: { item: t.GetType<typeof edit.AllEdits> }) {
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

function DiffEditRenderer({ item }: { item: t.GetType<typeof edit.DiffEdit> }) {
  return <Box flexDirection="column">
    <Text>Octo wants to replace the following:</Text>
    <Text color="gray">Original text:</Text>
    <Text color="gray">{item.search}</Text>
    <Text>New:</Text>
    <Text>{item.replace}</Text>
  </Box>
}

function CreateToolRenderer({ item }: { item: t.GetType<typeof createTool.Schema> }) {
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

const MAX_THOUGHTBOX_HEIGHT = 8;
const MAX_THOUGHTBOX_WIDTH = 80;
function AssistantMessageRenderer({ item }: { item: AssistantItem }) {
  const thoughtsRef = useRef<DOMElement | null>(null);
  const [ thoughtsHeight, setThoughtsHeight ] = useState(0);

  let thoughts = null;
  let content = item.content.trim();
  if(content.includes("<think>")) {
    const splits = item.content.split("</think>");
    thoughts = splits[0].replace("<think>", "").replace("</think>", "").trim();
    content = splits.slice(1).join("").trim();
  }

  useEffect(() => {
    if(thoughtsRef.current) {
      const { height } = measureElement(thoughtsRef.current);
      setThoughtsHeight(height);
    }
  }, [ thoughts ]);

  const thoughtsOverflow = thoughtsHeight - (MAX_THOUGHTBOX_HEIGHT - 2);
	return <Box>
    <Box marginRight={1} width={2} flexShrink={0} flexGrow={0}><Text>🐙</Text></Box>
    <Box flexDirection="column" flexGrow={1}>
      {
        thoughts && thoughts !== "" && <Box flexDirection="column">
          <Box
            flexGrow={0}
            flexShrink={1}
            height={thoughtsOverflow > 0 ? MAX_THOUGHTBOX_HEIGHT : undefined}
            width={MAX_THOUGHTBOX_WIDTH}
            overflowY="hidden"
            flexDirection="column"
            borderColor="gray"
            borderStyle="round"
          >
            <Box
              ref={thoughtsRef}
              flexShrink={0}
              width={MAX_THOUGHTBOX_WIDTH - 2}
              flexDirection="column"
              marginTop={-1 * Math.max(0, thoughtsOverflow)}
            >
              <Text color="gray">{thoughts}</Text>
            </Box>
          </Box>
        </Box>
      }
      <Box flexGrow={1}>
        <Text>{content}</Text>
      </Box>
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
