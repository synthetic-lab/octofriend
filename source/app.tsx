import * as fsOld from "fs";
import React, {
  useState, useCallback, useMemo, useEffect, useRef, createContext, useContext
} from "react";
import { Text, Box, Static, measureElement, DOMElement, useInput, useApp } from "ink";
import clipboardy from "clipboardy";
import { InputWithHistory } from "./components/input-with-history.tsx";
import { t } from "structural";
import {
  Config, Metadata, ConfigContext, ConfigPathContext, SetConfigContext, useConfig
} from "./config.ts";
import { HistoryItem, AssistantItem, ToolCallItem } from "./history.ts";
import Loading  from "./components/loading.tsx";
import { Header } from "./header.tsx";
import { UnchainedContext, useColor, useUnchained } from "./theme.ts";
import { DiffRenderer } from "./components/diff-renderer.tsx";
import { FileRenderer } from "./components/file-renderer.tsx";
import {
  shell,
  read,
  list,
  edit,
  append,
  prepend,
  rewrite,
  create as createTool,
  mcp,
  fetch as fetchTool,
  SKIP_CONFIRMATION,
} from "./tools/index.ts";
import { useShallow } from "zustand/react/shallow";
import SelectInput from "./components/ink/select-input.tsx";
import { useAppStore, RunArgs, useModel } from "./state.ts";
import { Octo } from "./components/octo.tsx";
import { IndicatorComponent, ItemComponent } from "./components/select.tsx";
import { Menu } from "./menu.tsx";
import { displayLog } from "./logger.ts";
import { CenteredBox } from "./components/centered-box.tsx";
import { Transport } from "./transports/transport-common.ts";
import { LocalTransport } from "./transports/local.ts";
import { markUpdatesSeen } from "./update-notifs/update-notifs.ts";
import { useCtrlC, ExitOnDoubleCtrlC, useCtrlCPressed } from "./components/exit-on-double-ctrl-c.tsx";
import { InputHistory } from "./input-history/index.ts";
import { Markdown } from "./markdown/index.tsx";
import { countLines } from "./str.ts";

type Props = {
	config: Config;
  configPath: string,
	metadata: Metadata,
  updates: string | null,
  unchained: boolean,
  transport: Transport,
  inputHistory: InputHistory,
};

type StaticItem = {
  type: "header",
} | {
  type: "version",
  metadata: Metadata,
  config: Config,
} | {
  type: "updates",
  updates: string,
} | {
  type: "slogan",
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

const TransportContext = createContext<Transport>(new LocalTransport());

export default function App({ config, configPath, metadata, unchained, transport, updates, inputHistory }: Props) {
  const [ currConfig, setCurrConfig ] = useState(config);
  const { history, modeData } = useAppStore(
    useShallow(state => ({
      history: state.history,
      modeData: state.modeData,
      modelOverride: state.modelOverride,
    }))
  );

  useEffect(() => {
    if(updates != null) markUpdatesSeen();
  }, []);

  const staticItems: StaticItem[] = useMemo(() => {
    return [
      { type: "header" },
      { type: "version", metadata, config: currConfig },
      ...(updates ? [{ type: "updates" as const, updates }] : []),
      { type: "slogan" },
      ...toStaticItems(history),
    ]
  }, [ history ]);

	return <SetConfigContext.Provider value={setCurrConfig}>
    <ConfigPathContext.Provider value={configPath}>
      <ConfigContext.Provider value={currConfig}>
        <UnchainedContext.Provider value={unchained}>
          <TransportContext.Provider value={transport}>
            <ExitOnDoubleCtrlC>
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
                <BottomBar inputHistory={inputHistory} metadata={metadata} />
              </Box>
            </ExitOnDoubleCtrlC>
          </TransportContext.Provider>
        </UnchainedContext.Provider>
      </ConfigContext.Provider>
    </ConfigPathContext.Provider>
  </SetConfigContext.Provider>
}

function BottomBar({ inputHistory, metadata }: {
  inputHistory: InputHistory
  metadata: Metadata,
}) {
  const [ versionCheck, setVersionCheck ] = useState("Checking for updates...");
  const themeColor = useColor();
  const ctrlCPressed = useCtrlCPressed();
  const { modeData } = useAppStore(
    useShallow(state => ({
      modeData: state.modeData,
    }))
  );

  useEffect(() => {
    getLatestVersion().then(latestVersion => {
      if(latestVersion && metadata.version < latestVersion) {
        setVersionCheck("New version released! Run `npm install -g --omit=dev octofriend` to update.");
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
    <BottomBarContent inputHistory={inputHistory} />
    <Box
      width="100%"
      justifyContent="space-between"
      height={1}
      flexShrink={0}
      flexGrow={1}
    >
      <Text color={themeColor}>
        { ctrlCPressed && "Press Ctrl+C again to exit." }
      </Text>
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

function BottomBarContent({ inputHistory }: { inputHistory: InputHistory }) {
  const config = useConfig();
  const transport = useContext(TransportContext);
	const [ query, setQuery ] = useState("");
  const { modeData, input, abortResponse, toggleMenu, byteCount } = useAppStore(
    useShallow(state => ({
      modeData: state.modeData,
      input: state.input,
      abortResponse: state.abortResponse,
      toggleMenu: state.toggleMenu,
      byteCount: state.byteCount,
    }))
  );

  useCtrlC(() => {
    setQuery("");
  });

  useInput((_, key) => {
    if(key.escape) {
      abortResponse();
      toggleMenu();
    }
  });
  const color = useColor();

	const onSubmit = useCallback(async () => {
		setQuery("");
    await input({ query, config, transport });
	}, [ query, config, transport ]);

  if(modeData.mode === "responding") {
    return <Box justifyContent="space-between">
      <Loading />
      <Box>
        {
          byteCount === 0 ? null : <Text color={color}>
            ⇩ {byteCount} bytes
          </Text>
        }
        <Text>{" "}</Text>
        <Text color="gray">(Press ESC to interrupt)</Text>
      </Box>
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
  if(modeData.mode === "payment-error") {
    return <PaymentErrorScreen error={modeData.error}/>
  }
  if(modeData.mode === "rate-limit-error") {
    return <RateLimitErrorScreen error={modeData.error}/>
  }
  if(modeData.mode === "request-error") {
    return <RequestErrorScreen error={modeData.error} curlCommand={modeData.curlCommand}/>
  }

  if(modeData.mode === "tool-request") {
    return <ToolRequestRenderer
      toolReq={modeData.toolReq}
      config={config}
      transport={transport}
    />;
  }

  const _: "menu" | "input" = modeData.mode;

  return <Box flexDirection="column">
    <Box marginLeft={1} justifyContent="flex-end">
      <Text color="gray">(Press ESC to enter the menu)</Text>
    </Box>
    <InputWithHistory
      inputHistory={inputHistory}
      value={query}
      onChange={setQuery}
      onSubmit={onSubmit}
    />
  </Box>
}

function RequestErrorScreen({ error, curlCommand }: { error: string, curlCommand: string | null }) {
  const config = useConfig();
  const transport = useContext(TransportContext);
  const { retryFrom } = useAppStore(
    useShallow(state => ({
      retryFrom: state.retryFrom,
    }))
  );
  const { exit } = useApp();

  const [viewError, setViewError] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);

  const items = [
    {
      label: "View error",
      value: "view" as const,
    },
    ... (
      curlCommand ? 
      [
        {
          label: copiedCurl ? "Copied cURL!" : "Copy failed request as cURL",
          value: "copy-curl" as const,
        }
      ] : []
    ),
    {
      label: "Retry",
      value: "retry" as const,
    },
    {
      label: "Quit Octo",
      value: "quit" as const,
    },
  ].filter(item => {
    if(viewError && item.value === "view") return false;
    return true;
  });

  const onSelect = useCallback((item: (typeof items)[number]) => {
    if(item.value === "view") {
      setViewError(true);
    }
    else if(item.value === "copy-curl" && curlCommand) {
      setCopiedCurl(true);
      clipboardy.writeSync(curlCommand);
    }
    else if(item.value === "retry") {
      retryFrom("request-error", { config, transport });
    }
    else {
      const _: "quit" = item.value;
      exit();
    }
  }, [curlCommand]);

  return <CenteredBox>
    <Text color="red">
      It looks like you've hit a request error!
    </Text>
    {
      viewError && <Box marginY={1}>
        <Text>
          { error }
        </Text>
      </Box>
    }
    {
      copiedCurl && <Box marginY={1}>
        <Text>
          { curlCommand }
        </Text>
      </Box>
    }
    <SelectInput
      items={items}
      onSelect={onSelect}
      indicatorComponent={IndicatorComponent}
      itemComponent={ItemComponent}
    />
  </CenteredBox>
}

function RateLimitErrorScreen({ error }: { error: string }) {
  const config = useConfig();
  const transport = useContext(TransportContext);
  const { retryFrom } = useAppStore(
    useShallow(state => ({
      retryFrom: state.retryFrom,
    }))
  );

  useInput(() => {
    retryFrom("rate-limit-error", { config, transport });
  });

  return <CenteredBox>
    <Text color="red">
      It looks like you've hit a rate limit! Here's the error from the backend:
    </Text>
    <Text>{error}</Text>
    <Text color="gray">Press any key when you're ready to retry.</Text>
  </CenteredBox>
}

function PaymentErrorScreen({ error }: { error: string }) {
  const config = useConfig();
  const transport = useContext(TransportContext);
  const { retryFrom } = useAppStore(
    useShallow(state => ({
      retryFrom: state.retryFrom,
    }))
  );

  useInput(() => {
    retryFrom("payment-error", { config, transport });
  });

  return <CenteredBox>
    <Text color="red">Payment error:</Text>
    <Text>{error}</Text>
    <Text color="gray">Once you've paid, press any key to continue.</Text>
  </CenteredBox>
}

function ToolRequestRenderer({ toolReq, config, transport }: {
  toolReq: ToolCallItem
} & RunArgs) {
  const themeColor = useColor();
  const { runTool, rejectTool } = useAppStore(
    useShallow(state => ({
      runTool: state.runTool,
      rejectTool: state.rejectTool,
    }))
  );
  const unchained = useUnchained();

  const prompt = (() => {
    const fn = toolReq.tool.function;
    switch (fn.name) {
      case "create":
        return <Box>
          <Text>Create file </Text>
          <Text color={themeColor}>{fn.arguments.filePath}</Text>
          <Text>?</Text>
        </Box>
      case "rewrite":
      case "append":
      case "prepend":
      case "edit":
        return <Box>
          <Text>Make these changes to </Text>
          <Text color={themeColor}>{fn.arguments.filePath}</Text>
          <Text>?</Text>
        </Box>
      case "read":
      case "shell":
      case "fetch":
      case "list":
      case "mcp":
        return null;
    }
  })();

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
    else await runTool({ toolReq, config, transport });
	}, [ toolReq, config, transport ]);

  const noConfirm = unchained || SKIP_CONFIRMATION.includes(toolReq.tool.function.name);
  useEffect(() => {
    if(noConfirm) {
      runTool({ toolReq, config, transport });
    }
  }, [ toolReq, noConfirm, config, transport ]);

  if(noConfirm) return <Loading />;

  return <Box flexDirection="column" gap={1}>
    { prompt }
    <SelectInput
      items={items}
      onSelect={onSelect}
      indicatorComponent={IndicatorComponent}
      itemComponent={ItemComponent}
    />
  </Box>
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
    </Box>
  }
  if(item.type === "slogan") {
    return <Box marginLeft={1} marginTop={1}>
      <Text>
        Octo is your friend. Tell Octo <Text color={themeColor}>what you want to do.</Text>
      </Text>
    </Box>
  }
  if(item.type === "updates") {
    return <Box marginTop={1} marginLeft={1} flexDirection="column">
      <Text bold>Updates:</Text>
      <Box marginTop={1} marginLeft={1}>
        <Markdown markdown={item.updates} />
      </Box>
      <Text color="gray">Thanks for updating!</Text>
      <Text color="gray">See the full changelog by running: `octo changelog`</Text>
    </Box>
  }

  return <MessageDisplay item={item.item} />
});

const MessageDisplay = React.memo(({ item }: {
  item: HistoryItem | Omit<AssistantItem, "id" | "tokenUsage" | "outputTokens"> // Allow inflight assistant messages
}) => {
  return <Box flexDirection="column" paddingRight={4}>
    <MessageDisplayInner item={item} />
  </Box>
});

const MessageDisplayInner = React.memo(({ item }: {
  item: HistoryItem | Omit<AssistantItem, "id" | "tokenUsage" | "outputTokens"> // Allow inflight assistant messages
}) => {
  if(item.type === "notification") {
    return <Box marginLeft={1}><Text color="gray">{item.content}</Text></Box>
  }
  if(item.type === "assistant") {
    return <Box marginBottom={1}>
      <AssistantMessageRenderer item={item} />
    </Box>
  }
  if(item.type === "tool") {
    return <Box marginTop={1}>
      <ToolMessageRenderer item={item} />
    </Box>
  }
  if(item.type === "tool-output") {
    const lines = (() => {
      if(item.result.lines == null) return item.result.content.split("\n").length;
      return item.result.lines;
    })();
    return <Box marginBottom={1}>
      <Text color="gray">
        Got <Text>{lines}</Text> lines of output
      </Text>
    </Box>
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
    return <Text color="red">Request failed.</Text>
  }

  // Type assertion proving we've handled all types other than user
  const _: "user" = item.type;

	return <Box marginY={1}>
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
    case "shell": return <ShellToolRenderer item={item.tool.function} />
    case "edit": return <EditToolRenderer item={item.tool.function} />
    case "create": return <CreateToolRenderer item={item.tool.function} />
    case "mcp": return <McpToolRenderer item={item.tool.function} />
    case "fetch": return <FetchToolRenderer item={item.tool.function} />
    case "append": return <AppendToolRenderer item={item.tool.function} />
    case "prepend": return <PrependToolRenderer item={item.tool.function} />
    case "rewrite": return <RewriteToolRenderer item={item.tool.function} />
  }
}

function AppendToolRenderer({ item }: { item: t.GetType<typeof append.Schema> }) {
  const { filePath, text } = item.arguments;
  const file = fsOld.readFileSync(filePath, "utf8");
  const lines = countLines(file);
  return <Box flexDirection="column" gap={1}>
    <Text>Octo wants to add the following to the end of the file:</Text>
    <FileRenderer contents={text} filePath={filePath} startLineNr={lines} />
  </Box>
}

function FetchToolRenderer({ item }: { item: t.GetType<typeof fetchTool.Schema> }) {
  const themeColor = useColor();
  return <Box>
		<Text color="gray">{item.name}: </Text>
		<Text color={themeColor}>{item.arguments.url}</Text>
	</Box>
}

function ShellToolRenderer({ item }: { item: t.GetType<typeof shell.Schema> }) {
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
    <DiffEditRenderer
      filePath={item.arguments.filePath}
      item={item.arguments}
    />
  </Box>
}

function PrependToolRenderer({ item }: { item: t.GetType<typeof prepend.Schema> }) {
  const { text, filePath } = item.arguments;
  return <Box flexDirection="column" gap={1}>
    <Text>Octo wants to add the following to the beginning of the file:</Text>
    <FileRenderer contents={text} filePath={filePath} />
  </Box>
}

function RewriteToolRenderer({ item }: { item: t.GetType<typeof rewrite.Schema> }) {
  const { text, filePath } = item.arguments;
  return <Box flexDirection="column" gap={1}>
    <Text>Octo wants to rewrite the file:</Text>
    <DiffRenderer
      oldText={fsOld.readFileSync(filePath, "utf8")}
      newText={text}
      filepath={filePath}
    />
  </Box>
}

function DiffEditRenderer({ item, filePath }: {
  item: t.GetType<typeof edit.ArgumentsSchema>,
  filePath: string,
}) {
  return <Box flexDirection="column">
    <Text>Octo wants to make the following changes:</Text>
    <DiffRenderer oldText={item.search} newText={item.replace} filepath={filePath} />
  </Box>
}

function CreateToolRenderer({ item }: { item: t.GetType<typeof createTool.Schema> }) {
  const themeColor = useColor();
  return <Box flexDirection="column" gap={1}>
    <Box>
      <Text>Octo wants to create </Text>
      <Text color={themeColor}>{item.arguments.filePath}</Text>
      <Text>:</Text>
    </Box>
    <Box>
      <FileRenderer contents={item.arguments.content} filePath={item.arguments.filePath} />
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
function AssistantMessageRenderer({ item }: {
  item: Omit<AssistantItem, "id" | "tokenUsage" | "outputTokens">,
}) {
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
        <Markdown markdown={content} />
      </Box>
    </Box>
  </Box>
}
