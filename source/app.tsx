import React, { useState, useMemo, useEffect, useRef, useContext, useLayoutEffect } from "react";
import { Text, Box, measureElement, DOMElement, useInput } from "ink";
import { Config, Metadata, ConfigContext, ConfigPathContext, SetConfigContext } from "./config.ts";
import { HistoryItem } from "./history.ts";
import { Header } from "./header.tsx";
import { UnchainedContext, useColor, useUnchained } from "./theme.ts";
import { useShallow } from "zustand/react/shallow";
import { useAppStore, useModel, InflightResponseType } from "./state.ts";
import { Octo } from "./components/octo.tsx";
import { displayLog } from "./logger.ts";
import { Transport } from "./transports/transport-common.ts";
import { TransportContext } from "./transport-context.ts";
import { markUpdatesSeen } from "./update-notifs/update-notifs.ts";
import { ExitOnDoubleCtrlC } from "./components/exit-on-double-ctrl-c.tsx";
import { InputHistory } from "./input-history/index.ts";
import { Markdown } from "./markdown/index.tsx";
import { LINE_SPLIT_REGEX } from "./str.ts";
import { ScrollView, IsScrollableContext } from "./components/scroll-view.tsx";
import { TerminalSizeTracker, useTerminalSize } from "./components/terminal-size.tsx";
import { ToolResult } from "./tools/common.ts";
import {
  InputPriorityProvider,
  usePriorityInput,
  UNCHAINED_PRIORITY,
} from "./hooks/use-priority-input.tsx";
import { CwdContext } from "./hooks/use-cwd.tsx";
import { BottomBar } from "./components/bottom-bar.tsx";
import { ToolMessageRenderer } from "./components/tool-message-renderer.tsx";
import { ToolCallRequest } from "./ir/llm-ir.ts";
import { Menu } from "./menu.tsx";

type Props = {
  config: Config;
  configPath: string;
  cwd: string;
  metadata: Metadata;
  updates: string | null;
  unchained: boolean;
  transport: Transport;
  inputHistory: InputHistory;
  bootSkills: string[];
};

type StaticItem =
  | {
      type: "header";
    }
  | {
      type: "version";
      metadata: Metadata;
      config: Config;
    }
  | {
      type: "updates";
      updates: string;
    }
  | {
      type: "slogan";
    }
  | {
      type: "history-item";
      item: HistoryItem;
    }
  | {
      type: "boot-notification";
      content: string;
    };

function CurrentToolRequestDisplay({ toolReq }: { toolReq: ToolCallRequest }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <ToolMessageRenderer item={toolReq} />
    </Box>
  );
}

function toStaticItems(messages: HistoryItem[]): Array<StaticItem> {
  return messages.map(message => ({
    type: "history-item",
    item: message,
  }));
}

const UNCHAINED_NOTIF = "Octo runs edits and shell commands automatically";
const CHAINED_NOTIF = "Octo asks permission before running edits or shell commands";
function UnchainedShiftTabHandler({
  setIsUnchained,
  setTempNotification,
}: {
  setIsUnchained: (fn: (prev: boolean) => boolean) => void;
  setTempNotification: (notif: string | null) => void;
}) {
  usePriorityInput(UNCHAINED_PRIORITY, (_, key) => {
    if (key.shift && key.tab) {
      setIsUnchained(prev => {
        const unchained = !prev;
        if (unchained) {
          setTempNotification(UNCHAINED_NOTIF);
        } else {
          setTempNotification(CHAINED_NOTIF);
        }
        return unchained;
      });
    }
  });
  return null;
}

export default function App({
  config,
  configPath,
  cwd,
  metadata,
  unchained,
  transport,
  updates,
  inputHistory,
  bootSkills,
}: Props) {
  const [currConfig, setCurrConfig] = useState(config);
  const [isUnchained, setIsUnchained] = useState(unchained);
  const [tempNotification, setTempNotification] = useState<string | null>(
    isUnchained ? UNCHAINED_NOTIF : CHAINED_NOTIF,
  );
  const [bottomBarHeight, setBottomBarHeight] = useState<number | null>(null);
  const [scrollContentHeight, setScrollContentHeight] = useState(0);
  const [isScrollable, setIsScrollable] = useState(false);
  const [toolRequestIndex, setToolRequestIndex] = useState(0);
  const finishingToolReqsRef = useRef<ToolCallRequest[] | null>(null);
  const { history, modeData, setVimMode, cancelNotifyReadyForInput, runAgent } = useAppStore(
    useShallow(state => ({
      history: state.history,
      modeData: state.modeData,
      setVimMode: state.setVimMode,
      cancelNotifyReadyForInput: state.cancelNotifyReadyForInput,
      runAgent: state.runAgent,
    })),
  );

  useInput(() => {
    cancelNotifyReadyForInput();
  });

  useEffect(() => {
    if (updates != null) markUpdatesSeen();
    if (currConfig.vimEmulation?.enabled) setVimMode("INSERT");
  }, []);

  const activeToolReqs = modeData.mode === "tool-request" ? modeData.toolReqs : null;
  const currentToolReq = activeToolReqs?.[toolRequestIndex] ?? null;

  useEffect(() => {
    finishingToolReqsRef.current = null;
    setToolRequestIndex(0);
  }, [activeToolReqs]);

  useEffect(() => {
    if (
      activeToolReqs &&
      toolRequestIndex >= activeToolReqs.length &&
      finishingToolReqsRef.current !== activeToolReqs
    ) {
      finishingToolReqsRef.current = activeToolReqs;
      runAgent({ config: currConfig, transport });
    }
  }, [activeToolReqs, toolRequestIndex, currConfig, transport, runAgent]);

  const skillNotifs: string[] = [];
  if (bootSkills.length > 0) {
    skillNotifs.push(" ");
    skillNotifs.push("Configured skills:");
    skillNotifs.push(...bootSkills.map(s => `- ${s}`));
  }

  const staticItems: StaticItem[] = useMemo(() => {
    let items = [
      { type: "header" as const },
      { type: "version" as const, metadata, config: currConfig },
      ...skillNotifs.map(s => ({ type: "boot-notification" as const, content: s })),
      ...(updates ? [{ type: "updates" as const, updates }] : []),
      { type: "slogan" as const },
      ...toStaticItems(history),
    ];

    return items;
  }, [history, currConfig, skillNotifs, updates]);

  const [termSize, setTermSize] = useState(() => ({
    height: process.stdout.rows || 20,
    width: process.stdout.columns || 80,
  }));

  useEffect(() => {
    const handleResize = () => {
      setTermSize({
        height: process.stdout.rows || 20,
        width: process.stdout.columns || 80,
      });
    };
    process.stdout.on("resize", handleResize);
    return () => {
      process.stdout.off("resize", handleResize);
    };
  }, []);

  const maxScrollViewHeight = Math.max(1, termSize.height - (bottomBarHeight ?? 0));
  const naturalScrollViewHeight = Math.max(1, scrollContentHeight);
  const isBottomBarPinned = naturalScrollViewHeight >= maxScrollViewHeight;
  const scrollViewHeight = isBottomBarPinned ? maxScrollViewHeight : naturalScrollViewHeight;
  const scrollView = (
    <ScrollView
      height={scrollViewHeight}
      onContentHeightChange={setScrollContentHeight}
      onScrollableChange={setIsScrollable}
    >
      {staticItems.map((item, index) => (
        <StaticItemRenderer item={item} key={`static-${index}`} />
      ))}
      {(modeData.mode === "responding" || modeData.mode === "compacting") &&
        (modeData.inflightResponse.reasoningContent || modeData.inflightResponse.content) && (
          <MessageDisplay item={modeData.inflightResponse} />
        )}
      {currentToolReq && <CurrentToolRequestDisplay toolReq={currentToolReq} />}
    </ScrollView>
  );
  const bottomBar = (
    <BottomBar
      inputHistory={inputHistory}
      metadata={metadata}
      tempNotification={tempNotification}
      onHeightChange={setBottomBarHeight}
      currentToolReq={currentToolReq}
      onToolRequestDone={() => setToolRequestIndex(index => index + 1)}
    />
  );

  return (
    <InputPriorityProvider>
      <UnchainedShiftTabHandler
        setIsUnchained={setIsUnchained}
        setTempNotification={setTempNotification}
      />
      <SetConfigContext.Provider value={setCurrConfig}>
        <ConfigPathContext.Provider value={configPath}>
          <ConfigContext.Provider value={currConfig}>
            <UnchainedContext.Provider value={isUnchained}>
              <TransportContext.Provider value={transport}>
                <CwdContext.Provider value={cwd}>
                  <ExitOnDoubleCtrlC>
                    <TerminalSizeTracker>
                      <IsScrollableContext.Provider value={isScrollable}>
                        {modeData.mode === "menu" ? (
                          <Menu />
                        ) : (
                          <Box
                            flexDirection={isBottomBarPinned ? "column-reverse" : "column"}
                            width="100%"
                            height={termSize.height}
                          >
                            {isBottomBarPinned ? (
                              <>
                                {bottomBar}
                                {scrollView}
                              </>
                            ) : (
                              <>
                                {scrollView}
                                <Box flexGrow={1} />
                                {bottomBar}
                              </>
                            )}
                          </Box>
                        )}
                      </IsScrollableContext.Provider>
                    </TerminalSizeTracker>
                  </ExitOnDoubleCtrlC>
                </CwdContext.Provider>
              </TransportContext.Provider>
            </UnchainedContext.Provider>
          </ConfigContext.Provider>
        </ConfigPathContext.Provider>
      </SetConfigContext.Provider>
    </InputPriorityProvider>
  );
}

const StaticItemRenderer = ({ item }: { item: StaticItem }) => {
  const themeColor = useColor();
  const model = useModel();
  const unchained = useUnchained();

  if (item.type === "header") return <Header unchained={unchained} />;
  if (item.type === "version") {
    return (
      <Box marginTop={1} marginLeft={1} flexDirection="column">
        <Text color="gray">Model: {model.nickname}</Text>
        <Text color="gray">Version: {item.metadata.version}</Text>
      </Box>
    );
  }
  if (item.type === "slogan") {
    return (
      <Box marginLeft={1} marginTop={1}>
        <Text>
          Octo is your friend. Tell Octo <Text color={themeColor}>what you want to do.</Text>
        </Text>
      </Box>
    );
  }
  if (item.type === "updates") {
    return (
      <Box marginTop={1} marginLeft={1} flexDirection="column">
        <Text bold>Updates:</Text>
        <Box marginTop={1} marginLeft={1}>
          <Markdown markdown={item.updates} />
        </Box>
        <Text color="gray">Thanks for updating!</Text>
        <Text color="gray">See the full changelog by running: `octo changelog`</Text>
      </Box>
    );
  }

  if (item.type === "boot-notification") {
    return (
      <Box marginLeft={1}>
        <Text color="gray">{item.content}</Text>
      </Box>
    );
  }

  return <MessageDisplay item={item.item} />;
};

const MessageDisplay = ({ item }: { item: HistoryItem | InflightResponseType }) => {
  return (
    <Box flexDirection="column" paddingRight={4}>
      <MessageDisplayInner item={item} />
    </Box>
  );
};

const MessageDisplayInner = ({ item }: { item: HistoryItem | InflightResponseType }) => {
  const { modeData } = useAppStore(
    useShallow(state => ({
      modeData: state.modeData,
    })),
  );

  if (item.type === "notification") {
    return (
      <Box marginLeft={1}>
        <Text color="gray">{item.content}</Text>
      </Box>
    );
  }
  if (item.type === "assistant") {
    if (modeData.mode === "compacting") {
      return (
        <Box marginBottom={1}>
          <CompactionRenderer item={item} />
        </Box>
      );
    }
    return (
      <Box marginBottom={1}>
        <AssistantMessageRenderer item={item} />
      </Box>
    );
  }
  if (item.type === "tool-calls") {
    // Tool calls don't need to be rendered: the tool output will handle rendering
    return null;
  }
  if (item.type === "tool-output") {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <ToolMessageRenderer item={item.toolCall} />
        <ToolOutputContentRenderer result={item.result} />
      </Box>
    );
  }
  if (item.type === "tool-malformed") {
    return (
      <Text color="red">
        {displayLog({
          verbose: `Error: ${item.malformedRequest.error}`,
          info: "Malformed tool call. Retrying...",
        })}
      </Text>
    );
  }

  if (item.type === "tool-validation-error") {
    const message = (() => {
      if (item.aborted) return "Tool call aborted.";
      return "Tool call failed validation checks. Retrying...";
    })();

    return (
      <Text color="red">
        {displayLog({
          verbose: `Error: ${item.error}`,
          info: message,
        })}
      </Text>
    );
  }

  if (item.type === "tool-failed") {
    return (
      <Box flexDirection="column">
        <Box marginLeft={2}>
          <Text color="red">
            {displayLog({
              verbose: `Error: ${item.error}`,
              info: "Tool failed...",
            })}
          </Text>
        </Box>
      </Box>
    );
  }
  if (item.type === "tool-reject") {
    return (
      <Box flexDirection="column">
        <ToolMessageRenderer item={item.toolCall} />
        <Box marginLeft={2}>
          <Text>Tool rejected; tell Octo what to do instead:</Text>
        </Box>
      </Box>
    );
  }

  // Tool skips are tracked internally for explaining to LLMs, but are not shown to users
  if (item.type === "tool-skip") {
    return null;
  }

  if (item.type === "file-outdated") {
    return (
      <Box flexDirection="column">
        <ToolMessageRenderer item={item.toolCall} />
        <Box marginLeft={2}>
          <Text>File was modified since it was last read; re-reading...</Text>
        </Box>
      </Box>
    );
  }
  if (item.type === "file-unreadable") {
    return (
      <Box flexDirection="column">
        <ToolMessageRenderer item={item.toolCall} />
        <Box marginLeft={2}>
          <Text>File could not be read — has it been deleted?</Text>
        </Box>
      </Box>
    );
  }

  if (item.type === "request-failed") {
    return <Text color="red">Request failed.</Text>;
  }

  if (item.type === "compaction-failed") {
    return <Text color="red">Compaction failed.</Text>;
  }

  if (item.type === "compaction-checkpoint") {
    return <CompactionSummaryRenderer summary={item.summary} />;
  }

  const _: "user" = item.type;

  const contentLines = item.content.split(LINE_SPLIT_REGEX);

  return (
    <Box flexDirection="column" marginY={1}>
      <Box flexDirection="row">
        <Box marginRight={1}>
          <Text color="white">▶</Text>
        </Box>
        {item.images && item.images.length > 0 && (
          <Box marginRight={1}>
            <Text inverse>
              ⟦ 📎 {item.images.length} image{item.images.length > 1 ? "s" : ""} attached ⟧
            </Text>
          </Box>
        )}
        <Box flexDirection="column">
          {contentLines.map((line, i) => (
            <Box key={i}>
              <Text>{line}</Text>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
};

function CompactionSummaryRenderer({ summary }: { summary: string }) {
  const color = useColor();
  const innerSummary = summary.replace(/^<summary>/, "").replace(/<\/summary>$/, "");
  return (
    <Box flexDirection="column" marginY={1}>
      <Text color="gray">History compacted! Summary: </Text>
      <Text color="gray">{innerSummary}</Text>
      <Text color={color}>Summary complete!</Text>
    </Box>
  );
}

function ToolOutputContentRenderer({ result }: { result: ToolResult }) {
  const lines = result.lines ?? result.content.split("\n").length;
  return (
    <Box marginLeft={2}>
      <Text color="gray">
        Got <Text>{lines}</Text> lines of output
      </Text>
    </Box>
  );
}

const OCTO_MARGIN = 1;
const OCTO_PADDING = 2;
function OctoMessageRenderer({ children }: { children?: React.ReactNode }) {
  return (
    <Box>
      <Box marginRight={OCTO_MARGIN} width={OCTO_PADDING} flexShrink={0} flexGrow={0}>
        <Octo />
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {children}
      </Box>
    </Box>
  );
}

function CompactionRenderer({ item }: { item: InflightResponseType }) {
  return (
    <OctoMessageRenderer>
      <Text color="gray">{item.content}</Text>
    </OctoMessageRenderer>
  );
}

function AssistantMessageRenderer({ item }: { item: InflightResponseType }) {
  let thoughts = item.reasoningContent ? item.reasoningContent.trim() : item.reasoningContent;
  let content = item.content.trim();

  const showThoughts = thoughts && thoughts !== "";
  return (
    <OctoMessageRenderer>
      {showThoughts && <ThoughtBox thoughts={thoughts} />}
      <Markdown markdown={content} />
    </OctoMessageRenderer>
  );
}

const MAX_THOUGHTBOX_HEIGHT = 8;
const MAX_THOUGHTBOX_WIDTH = 80;
const THOUGHTBOX_MARGIN = 4;
function ThoughtBox({ thoughts }: { thoughts: string }) {
  const thoughtsRef = useRef<DOMElement | null>(null);
  const [thoughtsHeight, setThoughtsHeight] = useState(0);
  const terminalSize = useTerminalSize();
  const thoughtsOverflow = thoughtsHeight - (MAX_THOUGHTBOX_HEIGHT - 2);
  const isScrollable = useContext(IsScrollableContext);

  useEffect(() => {
    if (thoughtsRef.current) {
      const { height } = measureElement(thoughtsRef.current);
      setThoughtsHeight(height);
    }
  }, [thoughts]);

  const enforceMaxHeight = thoughtsOverflow > 0 && !isScrollable;
  const octoSpace = OCTO_MARGIN + OCTO_PADDING + 1;
  const scrollBorderWidth = 2;
  const contentMaxWidth = terminalSize.width - THOUGHTBOX_MARGIN - octoSpace - scrollBorderWidth;
  const maxWidth = Math.min(contentMaxWidth, MAX_THOUGHTBOX_WIDTH);

  return (
    <Box flexDirection="column">
      <Box
        flexGrow={0}
        flexShrink={1}
        height={enforceMaxHeight ? MAX_THOUGHTBOX_HEIGHT : undefined}
        width={maxWidth}
        overflowY={enforceMaxHeight ? "hidden" : undefined}
        flexDirection="column"
        borderColor="gray"
        borderStyle="round"
      >
        <Box
          ref={thoughtsRef}
          flexGrow={0}
          flexShrink={0}
          flexDirection="column"
          marginTop={enforceMaxHeight ? -1 * Math.max(0, thoughtsOverflow) : 0}
        >
          <Text color="gray">{thoughts}</Text>
        </Box>
      </Box>
    </Box>
  );
}
