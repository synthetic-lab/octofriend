import * as fsOld from "fs";
import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Text, Box, Static, measureElement, DOMElement, useInput } from "ink";
import TextInput from "ink-text-input";
import { t } from "structural";
import {
  Config, Metadata, ConfigContext, ConfigPathContext, SetConfigContext, getModelFromConfig, useConfig
} from "./config.ts";
import { HistoryItem, AssistantItem, ToolCallItem } from "./history.ts";
import Loading from "./components/loading.tsx";
import { Header } from "./header.tsx";
import { UnchainedContext, useColor, useUnchained } from "./theme.ts";
import { DiffRenderer } from "./components/diff-renderer.tsx";
import {
  bash,
  read,
  list,
  edit,
  create as createTool,
  mcp,
  fetch as fetchTool,
  SKIP_CONFIRMATION,
} from "./tools/index.ts";
import { useShallow } from "zustand/react/shallow";
import SelectInput from "ink-select-input";
import { useAppStore, RunArgs, useModel } from "./state.ts";
import { Octo } from "./components/octo.tsx";
import { IndicatorComponent, ItemComponent } from "./components/select.tsx";
import { Menu } from "./menu.tsx";
import { displayLog } from "./logger.ts";

type Props = {
	config: Config;
  configPath: string,
	metadata: Metadata,
  unchained: boolean,
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

export default function App({ config, configPath, metadata, unchained }: Props) {
  const [ currConfig, setCurrConfig ] = useState(config);
  const { history, modeData } = useAppStore(
    useShallow(state => ({
      history: state.history,
      modeData: state.modeData,
      modelOverride: state.modelOverride,
    }))
  );

  const staticItems: StaticItem[] = useMemo(() => {
    return [
      { type: "header" },
      { type: "version", metadata, config: currConfig },
      ...toStaticItems(history),
    ]
  }, [ history ]);

	return <SetConfigContext.Provider value={setCurrConfig}>
    <ConfigPathContext.Provider value={configPath}>
      <ConfigContext.Provider value={currConfig}>
        <UnchainedContext.Provider value={unchained}>
          <Box flexDirection="column" width="100%" height="100%">
            <Static items={staticItems}>
              {
                (item, index) => <StaticItemRenderer item={item} key={`static-${index}`} />
              }
            </Static>

            {
              modeData.mode === "responding" &&
                (modeData.inflightResponse.reasoningContent || modeData.inflightResponse.content) &&
                <MessageDisplay item={modeData.inflightResponse} />
            }
            {
                <BottomBar metadata={metadata} />
            }
          </Box>
        </UnchainedContext.Provider>
      </ConfigContext.Provider>
    </ConfigPathContext.Provider>
  </SetConfigContext.Provider>
}

function BottomBar({ metadata }: {
  metadata: Metadata,
}) {
  const [ versionCheck, setVersionCheck ] = useState("Checking for updates...");
  const themeColor = useColor();
  const { modeData } = useAppStore(
    useShallow(state => ({
      modeData: state.modeData,
    }))
  );

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

  if(modeData.mode === "menu") return <Menu />

  return <Box flexDirection="column" width="100%">
    <BottomBarContent />
    <Box
      width="100%"
      justifyContent="flex-end"
      height={1}
      flexShrink={0}
      flexGrow={1}
    >
      <Text color={themeColor}>{versionCheck}</Text>
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

function BottomBarContent() {
  const config = useConfig();
	const [ query, setQuery ] = useState("");
  const { modeData, input, abortResponse, toggleMenu } = useAppStore(
    useShallow(state => ({
      modeData: state.modeData,
      input: state.input,
      abortResponse: state.abortResponse,
      toggleMenu: state.toggleMenu,
    }))
  );

  useInput((_, key) => {
    if(key.escape) {
      abortResponse();
      toggleMenu();
    }
  });

	const onSubmit = useCallback(async () => {
		setQuery("");
    await input({ query, config });
	}, [ query, config ]);

  if(modeData.mode === "responding") {
    return <Box justifyContent="space-between">
      <Loading />
      <Text color="gray">(Press ESC to interrupt)</Text>
    </Box>;
  }
  if(modeData.mode === "error-recovery") return <Loading />;
  if(modeData.mode === "diff-apply") {
    return <Loading overrideStrings={[
      "Auto-fixing diff",
    ]}/>
  };
  if(modeData.mode === "fix-json") {
    return <Loading overrideStrings={[
      "Auto-fixing JSON",
    ]}/>
  };
  if(modeData.mode === "tool-waiting") {
    return <Loading overrideStrings={[
      "Waiting",
      "Watching",
      "Smiling",
      "Hungering",
      "Splashing",
      "Writhing",
    ]} />
  }

  if(modeData.mode === "tool-request") {
    return <ToolRequestRenderer
      toolReq={modeData.toolReq}
      config={config}
    />;
  }

  const _: "menu" | "input" = modeData.mode;

  return <Box flexDirection="column">
    <Box marginLeft={1} justifyContent="flex-end">
      <Text color="gray">(Press ESC to enter the menu)</Text>
    </Box>
    <InputBox
      value={query}
      onChange={setQuery}
      onSubmit={onSubmit}
    />
  </Box>
}

function ToolRequestRenderer({ toolReq, config }: {
  toolReq: ToolCallItem
} & RunArgs) {
  const { runTool, rejectTool } = useAppStore(
    useShallow(state => ({
      runTool: state.runTool,
      rejectTool: state.rejectTool,
    }))
  );
  const unchained = useUnchained();

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
    if(item.value === "no") rejectTool(toolReq.tool.toolCallId);
    else await runTool({ toolReq, config });
	}, [ toolReq, config ]);

  const noConfirm = unchained || SKIP_CONFIRMATION.includes(toolReq.tool.function.name);
  useEffect(() => {
    if(noConfirm) {
      runTool({ toolReq, config });
    }
  }, [ toolReq, noConfirm, config ]);

  if(noConfirm) return <Loading />;

  return <SelectInput
    items={items}
    onSelect={onSelect}
    indicatorComponent={IndicatorComponent}
    itemComponent={ItemComponent}
  />
}


const StaticItemRenderer = React.memo(({ item }: { item: StaticItem }) => {
  const themeColor = useColor();
  const model = useModel();

  if(item.type === "header") return <Header />;
  if(item.type === "version") {
    return <Box marginTop={1} marginLeft={1} flexDirection="column">
      <Text color="gray">
        Model: {model.nickname}
      </Text>
      <Text color="gray">
        Version: {item.metadata.version}
      </Text>
      <Box marginTop={1}>
        <Text>
          Octo is your friend. Tell Octo <Text color={themeColor}>what you want to do.</Text>
        </Text>
      </Box>
    </Box>
  }

  return <MessageDisplay item={item.item} />
});

const MessageDisplay = React.memo(({ item }: {
  item: HistoryItem | Omit<AssistantItem, "id" | "tokenUsage"> // Allow inflight assistant messages
}) => {
  return <Box marginTop={1} marginBottom={1} flexDirection="column" paddingRight={4}>
    <MessageDisplayInner item={item} />
  </Box>
});

const MessageDisplayInner = React.memo(({ item }: {
  item: HistoryItem | Omit<AssistantItem, "id" | "tokenUsage"> // Allow inflight assistant messages
}) => {
  if(item.type === "notification") {
    return <Box marginLeft={1}><Text color="gray">{item.content}</Text></Box>
  }
	if(item.type === "assistant") return <AssistantMessageRenderer item={item} />
	if(item.type === "tool") return <ToolMessageRenderer item={item} />
	if(item.type === "tool-output") {
		return <Text color="gray">
			Got <Text>{item.content.split("\n").length}</Text> lines of output
		</Text>
	}
  if(item.type === "tool-malformed") {
    return <Text color="red">
      {
        displayLog({
          verbose: `Error: ${item.error}`,
          info: "Malformed tool call. Retrying...",
        })
      }
    </Text>
  }
  if(item.type === "tool-failed") {
    return <Text color="red">
      {
        displayLog({
          verbose: `Error: ${item.error}`,
          info: "Tool returned an error...",
        })
      }
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
    </Box>
  }
  if(item.type === "file-unreadable") {
    return <Box flexDirection="column">
      <Text>File could not be read — has it been deleted?</Text>
    </Box>
  }

  if(item.type === "request-failed") {
    return <Text color="red">Request failed. Retrying...</Text>
  }

  // Type assertion proving we've handled all types other than user
  const _: "user" = item.type;

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
  switch(item.tool.function.name) {
    case "read": return <ReadToolRenderer item={item.tool.function} />
    case "list": return <ListToolRenderer item={item.tool.function} />
    case "bash": return <BashToolRenderer item={item.tool.function} />
    case "edit": return <EditToolRenderer item={item.tool.function} />
    case "create": return <CreateToolRenderer item={item.tool.function} />
    case "mcp": return <McpToolRenderer item={item.tool.function} />
    case "fetch": return <FetchToolRenderer item={item.tool.function} />
  }
}

function FetchToolRenderer({ item }: { item: t.GetType<typeof fetchTool.Schema> }) {
  const themeColor = useColor();
  return <Box>
		<Text color="gray">{item.name}: </Text>
		<Text color={themeColor}>{item.arguments.url}</Text>
	</Box>
}

function BashToolRenderer({ item }: { item: t.GetType<typeof bash.Schema> }) {
  const themeColor = useColor();
  return <Box flexDirection="column">
    <Box>
      <Text color="gray">{item.name}: </Text>
      <Text color={themeColor}>{item.arguments.cmd}</Text>
    </Box>
		<Text color="gray">timeout: {item.arguments.timeout}</Text>
	</Box>
}

function ReadToolRenderer({ item }: { item: t.GetType<typeof read.Schema> }) {
  const themeColor = useColor();
  return <Box>
		<Text color="gray">{item.name}: </Text>
		<Text color={themeColor}>{item.arguments.filePath}</Text>
	</Box>
}

function ListToolRenderer({ item }: { item: t.GetType<typeof list.Schema> }) {
  const themeColor = useColor();
  return <Box>
		<Text color="gray">{item.name}: </Text>
		<Text color={themeColor}>{item?.arguments?.dirPath || process.cwd()}</Text>
	</Box>
}

function EditToolRenderer({ item }: { item: t.GetType<typeof edit.Schema> }) {
  const themeColor = useColor();
  return <Box flexDirection="column">
    <Box>
      <Text>Edit: </Text>
      <Text color={themeColor}>{item.arguments.filePath}</Text>
    </Box>
    <EditRenderer filePath={item.arguments.filePath} item={item.arguments.edit} />
  </Box>
}

function EditRenderer({ filePath, item }: {
  filePath: string,
  item: t.GetType<typeof edit.AllEdits>
}) {
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
    case "rewrite-whole":
      return <Box flexDirection="column">
        <Text>Octo wants to rewrite the file:</Text>
        <DiffRenderer oldText={fsOld.readFileSync(filePath, "utf8")} newText={item.text} />
      </Box>
  }
}

function DiffEditRenderer({ item }: { item: t.GetType<typeof edit.DiffEdit> }) {
  return <Box flexDirection="column">
    <Text>Octo wants to make the following changes:</Text>
    <DiffRenderer oldText={item.search} newText={item.replace} />
  </Box>
}

function CreateToolRenderer({ item }: { item: t.GetType<typeof createTool.Schema> }) {
  const themeColor = useColor();
  return <Box flexDirection="column">
    <Box>
      <Text>Create file: </Text>
      <Text color={themeColor}>{item.arguments.filePath}</Text>
    </Box>
    <Box flexDirection="column">
      <Text>With content:</Text>
      <Text>{item.arguments.content}</Text>
    </Box>
  </Box>
}

function McpToolRenderer({ item }: { item: t.GetType<typeof mcp.Schema> }) {
  const themeColor = useColor();
  return <Box flexDirection="column">
    <Box>
      <Text color="gray">{item.name}: </Text>
      <Text color={themeColor}>Server: {item.arguments.server}, Tool: {item.arguments.tool}</Text>
    </Box>
    <Text color="gray">Arguments: {JSON.stringify(item.arguments.arguments)}</Text>
  </Box>
}

const MAX_THOUGHTBOX_HEIGHT = 8;
const MAX_THOUGHTBOX_WIDTH = 80;
function AssistantMessageRenderer({ item }: { item: Omit<AssistantItem, "id" | "tokenUsage"> }) {
  const thoughtsRef = useRef<DOMElement | null>(null);
  const [ thoughtsHeight, setThoughtsHeight ] = useState(0);

  let thoughts = item.reasoningContent;
  let content = item.content.trim();

  useEffect(() => {
    if(thoughtsRef.current) {
      const { height } = measureElement(thoughtsRef.current);
      setThoughtsHeight(height);
    }
  }, [ thoughts ]);

  const thoughtsOverflow = thoughtsHeight - (MAX_THOUGHTBOX_HEIGHT - 2);
	return <Box>
    <Box marginRight={1} width={2} flexShrink={0} flexGrow={0}><Octo /></Box>
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
  const themeColor = useColor();
  return <Box width="100%" borderStyle="round" borderColor={themeColor} gap={1}>
    <Text color="gray">&gt;</Text>
    <TextInput value={props.value} onChange={props.onChange} onSubmit={props.onSubmit} />
  </Box>
});
