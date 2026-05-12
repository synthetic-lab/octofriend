import React, {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Box, DOMElement, measureElement, Text, useApp, useInput } from "ink";
import clipboardy from "clipboardy";
import { t } from "structural";
import { useShallow } from "zustand/react/shallow";
import { useConfig, Metadata } from "../config.ts";
import { InputHistory } from "../input-history/index.ts";
import { useAppStore, useModel } from "../state.ts";
import { TransportContext } from "../transport-context.ts";
import { ToolCallRequest } from "../ir/llm-ir.ts";
import Loading from "./loading.tsx";
import { CenteredBox } from "./centered-box.tsx";
import { useCtrlC, useCtrlCPressed } from "./exit-on-double-ctrl-c.tsx";
import { Item, ShortcutArray } from "./kb-select/kb-shortcut-select.tsx";
import { KbShortcutPanel } from "./kb-select/kb-shortcut-panel.tsx";
import { MultimediaInput } from "./multimedia-input.tsx";
import { VimModeIndicator } from "./vim-mode.tsx";
import { ImageInfo } from "../utils/image-utils.ts";
import { useColor, useUnchained, WHITE, PERMISSION_BAR_BACKGROUND } from "../theme.ts";
import { ALWAYS_REQUEST_PERMISSION_TOOLS, SKIP_CONFIRMATION_TOOLS } from "../tools/index.ts";
import { useCwd } from "../hooks/use-cwd.tsx";
import { useTerminalSize } from "./terminal-size.tsx";

const DEFAULT_BOTTOM_BAR_HEIGHT =
  3 + // input content: menu hint, bordered input, vim indicator/reserved minimum
  1 + // status row
  1; // notification row
const MAX_PERMISSION_BOTTOM_BAR_HEIGHT = 15;

function clampPermissionHeight(height: number, max: number): number {
  return Math.min(max, Math.max(1, height));
}

type BottomBarProps = {
  inputHistory: InputHistory;
  metadata: Metadata;
  tempNotification: string | null;
  onHeightChange: (height: number) => void;
  currentToolReq: ToolCallRequest | null;
  onToolRequestDone: () => void;
};

export function BottomBar({
  inputHistory,
  metadata,
  tempNotification,
  onHeightChange,
  currentToolReq,
  onToolRequestDone,
}: BottomBarProps) {
  const TEMP_NOTIFICATION_DURATION = 5000;

  const [versionCheck, setVersionCheck] = useState("Checking for updates...");
  const [displayedTempNotification, setDisplayedTempNotification] =
    useState<React.ReactNode | null>(null);
  const themeColor = useColor();
  const ctrlCPressed = useCtrlCPressed();
  const terminalSize = useTerminalSize();
  const contentRef = useRef<DOMElement>(null);
  const [measuredToolRequestHeight, setMeasuredToolRequestHeight] =
    useState(DEFAULT_BOTTOM_BAR_HEIGHT);
  const { modeData } = useAppStore(
    useShallow(state => ({
      modeData: state.modeData,
    })),
  );

  useEffect(() => {
    getLatestVersion().then(latestVersion => {
      if (latestVersion && metadata.version < latestVersion) {
        setVersionCheck(
          "New version released! Run `npm install -g --omit=dev octofriend` to update.",
        );
        return;
      }
      setVersionCheck("Octo is up-to-date.");
      setTimeout(() => {
        setVersionCheck("");
      }, 5000);
    });
  }, [metadata]);

  useEffect(() => {
    if (tempNotification) {
      setDisplayedTempNotification(tempNotification);
      const timer = setTimeout(() => {
        setDisplayedTempNotification(null);
      }, TEMP_NOTIFICATION_DURATION);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [tempNotification]);

  const unchained = useUnchained();
  const maxPermissionBottomBarHeight = Math.max(
    1,
    Math.min(MAX_PERMISSION_BOTTOM_BAR_HEIGHT, terminalSize.height - 2),
  );
  const visibleBottomBarHeight =
    modeData.mode === "tool-request"
      ? clampPermissionHeight(measuredToolRequestHeight, maxPermissionBottomBarHeight)
      : DEFAULT_BOTTOM_BAR_HEIGHT;

  useLayoutEffect(() => {
    if (modeData.mode !== "tool-request" || !contentRef.current) return;

    const { height } = measureElement(contentRef.current);
    const nextHeight = clampPermissionHeight(height, maxPermissionBottomBarHeight);
    setMeasuredToolRequestHeight(currentHeight =>
      currentHeight === nextHeight ? currentHeight : nextHeight,
    );
  });

  useEffect(() => {
    onHeightChange(visibleBottomBarHeight);
  }, [onHeightChange, visibleBottomBarHeight]);

  return (
    <Box
      flexDirection="column"
      width="100%"
      height={visibleBottomBarHeight}
      overflow="hidden"
      flexShrink={0}
    >
      <Box ref={contentRef} flexDirection="column" width="100%" flexShrink={0}>
        <Box flexDirection="column" width="100%" flexShrink={0}>
          <>
            <BottomBarContent
              inputHistory={inputHistory}
              currentToolReq={currentToolReq}
              onToolRequestDone={onToolRequestDone}
            />
            <Box width="100%" justifyContent="space-between" height={1} flexShrink={0} flexGrow={1}>
              <Box height={1}>
                <Text color={themeColor}>{ctrlCPressed && "Press Ctrl+C again to exit."}</Text>
                {!ctrlCPressed && (
                  <Text color={"gray"}>
                    {unchained ? "⚡ Unchained mode" : "Collaboration mode"}{" "}
                    <Text dimColor>(Shift+Tab to toggle)</Text>
                  </Text>
                )}
              </Box>
              <Text color={themeColor}>{versionCheck}</Text>
            </Box>
            <Box minHeight={1}>
              {displayedTempNotification && (
                <Box width="100%" flexShrink={0}>
                  <Text color={themeColor} wrap="wrap">
                    {displayedTempNotification}
                  </Text>
                </Box>
              )}
            </Box>
          </>
        </Box>
      </Box>
    </Box>
  );
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

function BottomBarContent({
  inputHistory,
  currentToolReq,
  onToolRequestDone,
}: {
  inputHistory: InputHistory;
  currentToolReq: ToolCallRequest | null;
  onToolRequestDone: () => void;
}) {
  const config = useConfig();
  const model = useModel();
  const transport = useContext(TransportContext);
  const vimEnabled = !!config.vimEmulation?.enabled;
  const {
    modeData,
    input,
    abortResponse,
    openMenu,
    closeMenu,
    byteCount,
    setVimMode,
    query,
    setQuery,
  } = useAppStore(
    useShallow(state => ({
      modeData: state.modeData,
      input: state.input,
      abortResponse: state.abortResponse,
      closeMenu: state.closeMenu,
      openMenu: state.openMenu,
      byteCount: state.byteCount,
      setVimMode: state.setVimMode,
      query: state.query,
      setQuery: state.setQuery,
    })),
  );

  const vimMode =
    vimEnabled && vimEnabled && modeData.mode === "input" ? modeData.vimMode : "NORMAL";

  useCtrlC(() => {
    if (vimEnabled) return;
    setQuery("");
  });

  useInput((input, key) => {
    if (key.escape) {
      if (vimEnabled && vimMode === "INSERT" && modeData.mode === "input") {
        setVimMode("NORMAL");
        return;
      }

      abortResponse();
      if (modeData.mode === "menu") closeMenu();
    }

    if (key.ctrl && input === "p") {
      openMenu();
    }
  });
  const color = useColor();

  const onSubmit = useCallback(
    async (submittedQuery?: string, images?: ImageInfo[]) => {
      const finalQuery = submittedQuery ?? query;
      setQuery("");
      await input({ query: finalQuery, config, transport, images });
    },
    [query, config, transport, setQuery],
  );

  if (modeData.mode === "responding" || modeData.mode === "compacting") {
    return (
      <Box justifyContent="space-between">
        <Loading
          overrideStrings={
            modeData.mode === "compacting"
              ? ["Compacting history to save context tokens"]
              : undefined
          }
        />
        <Box>
          {byteCount === 0 ? null : <Text color={color}>⇩ {byteCount} bytes</Text>}
          <Text> </Text>
          <Text color="gray">(Press ESC to interrupt)</Text>
        </Box>
      </Box>
    );
  }
  if (modeData.mode === "error-recovery") return <Loading />;
  if (modeData.mode === "diff-apply") {
    return <Loading overrideStrings={["Auto-fixing diff"]} />;
  }
  if (modeData.mode === "fix-json") {
    return <Loading overrideStrings={["Auto-fixing JSON"]} />;
  }
  if (modeData.mode === "payment-error") {
    return <PaymentErrorScreen error={modeData.error} />;
  }
  if (modeData.mode === "rate-limit-error") {
    return <RateLimitErrorScreen error={modeData.error} />;
  }
  if (modeData.mode === "request-error") {
    return (
      <RequestErrorScreen
        mode="request-error"
        contextualMessage="It looks like you've hit a request error!"
        error={modeData.error}
        curlCommand={modeData.curlCommand}
      />
    );
  }
  if (modeData.mode === "compaction-error") {
    return (
      <RequestErrorScreen
        mode="compaction-error"
        contextualMessage="History compaction failed due to a request error!"
        error={modeData.error}
        curlCommand={modeData.curlCommand}
      />
    );
  }

  if (modeData.mode === "tool-request") {
    if (!currentToolReq) return <Loading />;
    return <ToolRequestRenderer toolReq={currentToolReq} onDone={onToolRequestDone} />;
  }

  const _: "menu" | "input" = modeData.mode;

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box marginLeft={1} justifyContent="flex-end">
        <Text color="gray">(Ctrl+p to enter the menu)</Text>
      </Box>
      <MultimediaInput
        inputHistory={inputHistory}
        value={query}
        onChange={setQuery}
        onSubmit={onSubmit}
        vimEnabled={vimEnabled}
        vimMode={vimMode}
        setVimMode={setVimMode}
        modalities={model.modalities}
      />
      <VimModeIndicator vimEnabled={vimEnabled} vimMode={vimMode} />
    </Box>
  );
}

type ToolRequestSelectItem = {
  label: string;
  value: string;
  whitelistAllowDescription?: (textColor: string | undefined) => React.ReactNode;
};

const ToolRequestItem = ({
  isSelected = false,
  item,
}: {
  isSelected?: boolean;
  item: ToolRequestSelectItem;
}) => {
  const themeColor = useColor();
  const color = isSelected ? themeColor : "dim";

  return (
    <Box position="relative">
      <Box
        minWidth={18}
        borderStyle="round"
        borderColor={color}
        borderBackgroundColor={PERMISSION_BAR_BACKGROUND}
        paddingX={2}
        flexDirection="column"
        backgroundColor={PERMISSION_BAR_BACKGROUND}
      >
        <Box flexGrow={1} />
        <Box flexDirection="column" alignItems="center">
          {item.whitelistAllowDescription ? (
            item.whitelistAllowDescription(color)
          ) : (
            <Text color={color} wrap="wrap">
              {item.label}
            </Text>
          )}
        </Box>
        <Box flexGrow={1.01} />
      </Box>
      {isSelected && (
        <Box position="absolute" top={1} left={0}>
          <Text color={color}>▶</Text>
        </Box>
      )}
    </Box>
  );
};

function ToolRequestSelect({
  items,
  onSelect,
}: {
  items: ToolRequestSelectItem[];
  onSelect: (item: ToolRequestSelectItem) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(index => Math.min(index, Math.max(0, items.length - 1)));
  }, [items.length]);

  useInput(
    useCallback(
      (input, key) => {
        if (key.leftArrow) {
          setSelectedIndex(index => Math.max(0, index - 1));
        }

        if (key.rightArrow || (key.tab && !key.shift)) {
          setSelectedIndex(index => Math.min(items.length - 1, index + 1));
        }

        if (/^[1-9]$/.test(input)) {
          const targetIndex = Number.parseInt(input, 10) - 1;
          if (targetIndex >= 0 && targetIndex < items.length) {
            onSelect(items[targetIndex]!);
          }
        }

        if (key.return) {
          onSelect(items[selectedIndex]!);
        }
      },
      [items, onSelect, selectedIndex],
    ),
  );

  return (
    <Box
      width="100%"
      backgroundColor={PERMISSION_BAR_BACKGROUND}
      paddingX={1}
      justifyContent="space-between"
      alignItems="flex-end"
      flexWrap="wrap"
    >
      <Box flexDirection="row" gap={1} flexShrink={1}>
        {items.map((item, index) => (
          <ToolRequestItem key={item.value} item={item} isSelected={index === selectedIndex} />
        ))}
      </Box>
      <Box justifyContent="flex-end" flexShrink={0} gap={2}>
        <Box gap={1}>
          <Text bold color={WHITE}>
            ←/→
          </Text>
          <Text color="dim">select</Text>
        </Box>
        <Box gap={1}>
          <Text bold color={WHITE}>
            enter
          </Text>
          <Text color="dim">confirm</Text>
        </Box>
      </Box>
    </Box>
  );
}

function ToolRequestRenderer({
  toolReq,
  onDone,
}: {
  toolReq: ToolCallRequest;
  onDone: () => void;
}) {
  const config = useConfig();
  const transport = useContext(TransportContext);
  const themeColor = useColor();
  const { runTool, rejectTool, isWhitelisted, addToWhitelist, notifyReadyForInput } = useAppStore(
    useShallow(state => ({
      runTool: state.runTool,
      rejectTool: state.rejectTool,
      isWhitelisted: state.isWhitelisted,
      addToWhitelist: state.addToWhitelist,
      notifyReadyForInput: state.notifyReadyForInput,
    })),
  );
  const unchained = useUnchained();
  const whitelistKey = (() => {
    const fn = toolReq.call.parsed;
    switch (fn.name) {
      case "read":
      case "list":
        return "read:*";
      case "create":
      case "rewrite":
      case "append":
      case "prepend":
      case "edit":
        return "edits:*";
      case "mcp":
        return `${fn.name}:${fn.arguments.server}:${fn.arguments.tool}`;
      case "skill":
      case "shell":
      case "fetch":
      case "glob":
      case "grep":
      case "web-search":
      case "lsp-definition":
      case "lsp-references":
      case "lsp-hover":
      case "lsp-diagnostics":
      case "lsp-document-symbol":
      case "lsp-implementation":
      case "lsp-incoming-calls":
      case "lsp-outgoing-calls":
        return `${fn.name}:*`;
    }
  })();

  const prompt = (() => {
    const fn = toolReq.call.parsed;
    switch (fn.name) {
      case "create":
        return (
          <Box>
            <Text>Create file </Text>
            <Text color={themeColor}>{fn.arguments.filePath}</Text>
            <Text>?</Text>
          </Box>
        );
      case "rewrite":
      case "append":
      case "prepend":
      case "edit":
        return (
          <Box>
            <Text>Make these changes to </Text>
            <Text color={themeColor}>{fn.arguments.filePath}</Text>
            <Text>?</Text>
          </Box>
        );
      case "skill":
      case "read":
      case "shell":
      case "fetch":
      case "list":
      case "mcp":
      case "glob":
      case "grep":
      case "web-search":
      case "lsp-definition":
      case "lsp-references":
      case "lsp-hover":
      case "lsp-diagnostics":
      case "lsp-document-symbol":
      case "lsp-implementation":
      case "lsp-incoming-calls":
      case "lsp-outgoing-calls":
        return null;
    }
  })();

  const toolName = toolReq.call.parsed.name;

  const [isToolWhitelisted, setIsToolWhitelisted] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const whitelisted = await isWhitelisted(whitelistKey);
      setIsToolWhitelisted(whitelisted);
    })();
  }, [whitelistKey, isWhitelisted]);

  const items: ToolRequestSelectItem[] = [
    {
      label: "Yes",
      value: "yes",
    },
    ...(!SKIP_CONFIRMATION_TOOLS.includes(toolName) &&
    !ALWAYS_REQUEST_PERMISSION_TOOLS.includes(toolName) &&
    !isToolWhitelisted
      ? [
          {
            label: "",
            value: "yes-whitelist",
            whitelistAllowDescription: (textColor: string | undefined) => (
              <WhitelistAllowDescription toolCallRequest={toolReq} textColor={textColor} />
            ),
          },
        ]
      : []),
    {
      label: "No, and tell Octo what to do differently",
      value: "no",
    },
  ];

  const onSelect = useCallback(
    async (item: (typeof items)[number]) => {
      if (item.value === "no") {
        rejectTool(toolReq);
      } else if (item.value === "yes-whitelist") {
        await addToWhitelist(whitelistKey);
        await runTool({ toolReq, config, transport });
        onDone();
      } else {
        await runTool({ toolReq, config, transport });
        onDone();
      }
    },
    [toolReq, config, transport, addToWhitelist, runTool, rejectTool, whitelistKey, onDone],
  );

  const { modeData } = useAppStore(useShallow(state => ({ modeData: state.modeData })));
  const isRunning =
    modeData.mode === "tool-request" && modeData.runningToolCallId === toolReq.toolCallId;

  const noConfirmationNeeded =
    unchained ||
    SKIP_CONFIRMATION_TOOLS.includes(toolReq.call.parsed.name) ||
    isToolWhitelisted === true;

  useEffect(() => {
    if (noConfirmationNeeded) {
      runTool({ toolReq, config, transport }).then(onDone);
    } else {
      notifyReadyForInput(config);
    }
  }, [toolReq, noConfirmationNeeded, config, transport, runTool, notifyReadyForInput, onDone]);

  if (noConfirmationNeeded || isRunning) {
    return (
      <Loading
        overrideStrings={["Waiting", "Watching", "Smiling", "Hungering", "Splashing", "Writhing"]}
      />
    );
  }

  return (
    <Box flexDirection="column">
      {prompt}
      <Text color="gray">Awaiting your permission.</Text>
      <ToolRequestSelect items={items} onSelect={onSelect} />
    </Box>
  );
}

function WhitelistAllowDescription({
  toolCallRequest,
  textColor,
}: {
  toolCallRequest: ToolCallRequest;
  textColor: string | undefined;
}) {
  const fn = toolCallRequest.call.parsed;
  const cwd = useCwd();
  switch (fn.name) {
    case "glob":
      return <Text color={textColor}>Always allow glob searches</Text>;
    case "grep":
      return <Text color={textColor}>Always allow grep searches</Text>;
    case "shell": {
      return (
        <Text color={textColor}>
          <Text>Always allow from </Text>
          <Text color={textColor} bold>
            {fn.arguments.cmd}
          </Text>
        </Text>
      );
    }
    case "fetch": {
      return <Text color={textColor}>Always allow web fetches</Text>;
    }
    case "web-search": {
      return <Text color={textColor}>Always allow web searches</Text>;
    }
    case "list":
    case "read": {
      return (
        <Box flexDirection="column" alignItems="center">
          <Text color={textColor}>Always allow reads in</Text>
          <Text color={textColor} bold>
            {cwd}
          </Text>
        </Box>
      );
    }
    case "edit":
    case "create":
    case "append":
    case "prepend":
    case "rewrite": {
      return (
        <Box flexDirection="column" alignItems="center">
          <Text color={textColor}>Always allow changes in</Text>
          <Text color={textColor} bold>
            {cwd}
          </Text>
        </Box>
      );
    }
    case "mcp": {
      return (
        <Text color={textColor}>
          Always allow {fn.arguments.server}/{fn.arguments.tool}
        </Text>
      );
    }
    case "skill": {
      return <Text color={textColor}>Always allow {fn.arguments.skillName}</Text>;
    }
    case "lsp-definition":
    case "lsp-references":
    case "lsp-hover":
    case "lsp-diagnostics":
    case "lsp-document-symbol":
    case "lsp-implementation":
    case "lsp-incoming-calls":
    case "lsp-outgoing-calls":
      return <Text color={textColor}>Always allow LSP queries</Text>;
  }
}

function RequestErrorScreen({
  mode,
  contextualMessage,
  error,
  curlCommand,
}: {
  mode: "request-error" | "compaction-error";
  contextualMessage: string;
  error: string;
  curlCommand: string | null;
}) {
  const config = useConfig();
  const transport = useContext(TransportContext);
  const { retryFrom, editAndRetryFrom } = useAppStore(
    useShallow(state => ({
      retryFrom: state.retryFrom,
      editAndRetryFrom: state.editAndRetryFrom,
    })),
  );
  const { exit } = useApp();

  const [viewError, setViewError] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [clipboardError, setClipboardError] = useState<string | null>(null);

  const mapping: Record<string, Item<"view" | "copy-curl" | "retry" | "edit-retry" | "quit">> = {};

  if (!viewError) {
    mapping["v"] = {
      label: "View error",
      value: "view",
    };
  }

  if (curlCommand) {
    mapping["c"] = {
      label: copiedCurl ? "Copied cURL!" : "Copy failed request as cURL",
      value: "copy-curl",
    };
  }

  mapping["r"] = {
    label: "Retry",
    value: "retry",
  };

  mapping["e"] = {
    label: "Edit & retry",
    value: "edit-retry",
  };

  mapping["q"] = {
    label: "Quit Octo",
    value: "quit",
  };

  const shortcutItems: ShortcutArray<"view" | "copy-curl" | "retry" | "edit-retry" | "quit"> = [
    {
      type: "key" as const,
      mapping,
    },
  ];

  const onSelect = useCallback(
    (item: Item<"view" | "copy-curl" | "retry" | "edit-retry" | "quit">) => {
      if (item.value === "view") {
        setViewError(true);
      } else if (item.value === "copy-curl") {
        try {
          clipboardy.writeSync(curlCommand || "Failed to generate cURL command");
          setCopiedCurl(true);
        } catch (error) {
          setClipboardError(error instanceof Error ? error.message : "Failed to copy to clipboard");
        }
      } else if (item.value === "retry") {
        retryFrom(mode, { config, transport });
      } else if (item.value === "edit-retry") {
        editAndRetryFrom(mode, { config, transport });
      } else {
        const _: "quit" = item.value;
        exit();
      }
    },
    [curlCommand, mode, config, transport],
  );

  return (
    <KbShortcutPanel title="" shortcutItems={shortcutItems} onSelect={onSelect}>
      <Text color="red">{contextualMessage}</Text>
      {viewError && (
        <Box marginY={1}>
          <Text>{error}</Text>
        </Box>
      )}
      {copiedCurl && (
        <Box marginY={1}>
          <Text>{curlCommand}</Text>
        </Box>
      )}
      {clipboardError && (
        <Box marginY={1}>
          <Text color="red">{clipboardError}</Text>
        </Box>
      )}
    </KbShortcutPanel>
  );
}

function RateLimitErrorScreen({ error }: { error: string }) {
  const config = useConfig();
  const transport = useContext(TransportContext);
  const { retryFrom } = useAppStore(
    useShallow(state => ({
      retryFrom: state.retryFrom,
    })),
  );

  useInput(() => {
    retryFrom("rate-limit-error", { config, transport });
  });

  return (
    <CenteredBox>
      <Text color="red">
        It looks like you've hit a rate limit! Here's the error from the backend:
      </Text>
      <Text>{error}</Text>
      <Text color="gray">Press any key when you're ready to retry.</Text>
    </CenteredBox>
  );
}

function PaymentErrorScreen({ error }: { error: string }) {
  const config = useConfig();
  const transport = useContext(TransportContext);
  const { retryFrom } = useAppStore(
    useShallow(state => ({
      retryFrom: state.retryFrom,
    })),
  );

  useInput(() => {
    retryFrom("payment-error", { config, transport });
  });

  return (
    <CenteredBox>
      <Text color="red">Payment error:</Text>
      <Text>{error}</Text>
      <Text color="gray">Once you've paid, press any key to continue.</Text>
    </CenteredBox>
  );
}
