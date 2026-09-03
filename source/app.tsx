import React, {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  useContext,
} from "react";
import type { DivElement } from "paintcannon";
import clipboardy from "clipboardy";
import { t } from "structural";
import {
  Auth,
  AuthError,
  Config,
  Metadata,
  ConfigContext,
  ConfigPathContext,
  SetConfigContext,
  matchModelFromConfig,
  mergeEnvVar,
  readAuthForModel,
  useConfig,
  useSetConfig,
} from "./config.ts";
import Loading from "./components/loading.tsx";
import { Header } from "./header.tsx";
import {
  DIMMED_SCROLLBAR_COLOR,
  SCROLLBAR_COLOR,
  SUBTLE_SCROLLBAR_COLOR,
  THOUGHTBOX_COLOR,
  UnchainedContext,
  useColor,
  useUnchained,
} from "./theme.ts";
import { DiffRenderer } from "./components/diff-renderer.tsx";
import { FileRenderer } from "./components/file-renderer.tsx";
import shell from "./tools/tool-defs/bash.ts";
import read from "./tools/tool-defs/read.ts";
import partialRead from "./tools/tool-defs/partial-read.ts";
import list from "./tools/tool-defs/list.ts";
import edit from "./tools/tool-defs/edit.ts";
import rewrite from "./tools/tool-defs/rewrite.ts";
import createTool from "./tools/tool-defs/create.ts";
import mcp from "./tools/tool-defs/mcp.ts";
import fetchTool from "./tools/tool-defs/fetch.ts";
import skill from "./tools/tool-defs/skill.ts";
import webSearch from "./tools/tool-defs/web-search.ts";
import glob from "./tools/tool-defs/glob.ts";
import grep from "./tools/tool-defs/grep.ts";
import backgroundProcess from "./tools/tool-defs/background-process.ts";
import manageBackgroundProcess from "./tools/tool-defs/manage-background-process.ts";
import { ALWAYS_REQUEST_PERMISSION_TOOLS, SKIP_CONFIRMATION_TOOLS } from "./tools/index.ts";
import { ParsedSchema as EditParsedSchema } from "./tools/tool-defs/edit.ts";
import { useShallow } from "zustand/react/shallow";
import { KbShortcutPanel } from "./components/kb-select/kb-shortcut-panel.tsx";
import { Item, ShortcutArray } from "./components/kb-select/kb-shortcut-select.tsx";
import {
  useAppStore,
  RunArgs,
  useModel,
  InflightResponseType,
  nextToolAction,
  QueuedUserMessage,
  UiState,
  inputFieldAvailable,
} from "./state.ts";
import { SessionNotFoundError } from "./session-history/index.ts";
import type { HistoryNode, Session } from "./session-history/index.ts";
import { tryDeserializeModelJson } from "./session-history/model-json.ts";
import { Octo } from "./components/octo.tsx";
import { Menu } from "./menu.tsx";
import { Modal } from "./components/modal.tsx";
import SelectInput from "./components/selection/select-input.tsx";
import { IndicatorComponent } from "./components/select.tsx";
import { displayLog } from "./logger.ts";
import { CenteredBox } from "./components/centered-box.tsx";
import { Transport } from "./transports/transport-common.ts";
import { TransportContext } from "./transport-context.ts";
import { SessionContext, useSession } from "./session-context.ts";
import { markUpdatesSeen } from "./update-notifs/update-notifs.ts";
import {
  useCtrlC,
  ExitOnDoubleCtrlC,
  useCtrlCPressed,
} from "./components/exit-on-double-ctrl-c.tsx";
import { InputHistory } from "./input-history/index.ts";
import { MultimediaInput } from "./components/multimedia-input.tsx";
import { ImageInfo } from "./utils/image-utils.ts";
import { Markdown } from "./markdown/index.tsx";
import { LINE_SPLIT_REGEX, excerpt } from "./str.ts";
import { VimModeIndicator } from "./components/vim-mode.tsx";
import { DEFAULT_INPUT_MODE, type InputMode, type VimMode } from "./components/input-mode.ts";
import type { ToolCall } from "./libocto/tool-def.ts";
import type toolMap from "./tools/tool-defs/index.ts";
import type { Content, MalformedToolRequest } from "./libocto/llm-ir.ts";
import type { OctoIR } from "./ir/octo-ir.ts";
import {
  InputPriorityProvider,
  usePriorityInput,
  UNCHAINED_PRIORITY,
} from "./hooks/use-priority-input.tsx";
import { writeFileSync } from "fs";
import os from "os";
import path from "path";
import { CwdContext, useCwd } from "./hooks/use-cwd.tsx";
import { LspToolRenderer } from "./components/lsp-tool-renderer.tsx";
import { CustomAuthFlow } from "./components/add-model-flow.tsx";
import { Span, useAnimation, useApp } from "paintcannon-react";
import { useKeyboard } from "./hooks/use-keyboard.ts";
import { TerminalFlex } from "./components/terminal-flex.tsx";
import { AppShell } from "./components/app-shell.tsx";
import { ToolCallRow } from "./components/tool-call-row.tsx";
import { useToast } from "./components/toast.tsx";
import { ReactDevelopmentBuildToast } from "./components/react-development-build-toast.tsx";
import {
  ScrollTranscriptToBottomContext,
  useScrollTranscriptToBottom,
} from "./transcript-scroll.ts";
type LoadedToolFrom<T extends (...args: any) => any> = Exclude<Awaited<ReturnType<T>>, null>;
type ParsedToolSchemaFrom<T extends (...args: any) => any> = {
  name: LoadedToolFrom<T>["name"];
  arguments: t.GetType<LoadedToolFrom<T>["ParsedSchema"]>;
};
type ToolCallRequest = ToolCall<typeof toolMap>;
type AssistantDisplayItem = {
  content: string;
  reasoningContent?: string | null;
};
type Props = {
  config: Config;
  configPath: string;
  cwd: string;
  metadata: Metadata;
  updates: string | null;
  unchained: boolean;
  transport: Transport;
  session: Session;
  onSessionChange: (session: Session) => void;
  inputHistory: InputHistory;
  bootSkills: string[];
};
type TranscriptItem =
  | {
      type: "header";
    }
  | {
      type: "version";
      metadata: Metadata;
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
      item: HistoryNode;
    }
  | {
      type: "boot-notification";
      content: string;
    };
const UNCHAINED_NOTIF = "Octo runs edits and shell commands automatically";
const CHAINED_NOTIF = "Octo asks permission before running edits or shell commands";
const KEYBOARD_SCROLL_DURATION_MS = 80;
function UnchainedShiftTabHandler({
  setIsUnchained,
  setTempNotification,
}: {
  setIsUnchained: (fn: (prev: boolean) => boolean) => void;
  setTempNotification: (notif: string | null) => void;
}) {
  usePriorityInput(UNCHAINED_PRIORITY, event => {
    if (event.shiftKey && event.key === "Tab") {
      event.preventDefault();
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
  session: initialSession,
  onSessionChange,
  updates,
  inputHistory,
  bootSkills,
}: Props) {
  const { paintCannon } = useApp();
  const showToast = useToast();
  const [hasFocus, setHasFocus] = useState(paintCannon.hasFocus);
  const transcriptRef = useRef<DivElement>(null);
  const followTranscriptRef = useRef(true);
  const keyboardScrollActiveRef = useRef(false);
  const keyboardScrollStartRef = useRef(0);
  const [isKeyboardScrollActive, setIsKeyboardScrollActive] = useState(false);
  const { time: keyboardScrollTime } = useAnimation({
    isActive: isKeyboardScrollActive,
  });
  useEffect(() => {
    const handleBlur = () => setHasFocus(false);
    const handleFocus = () => setHasFocus(true);

    const handleClipboardWrite = () => showToast("Copied to clipboard");

    paintCannon.addEventListener("blur", handleBlur);
    paintCannon.addEventListener("focus", handleFocus);
    paintCannon.addEventListener("clipboardWrite", handleClipboardWrite);
    return () => {
      paintCannon.removeEventListener("blur", handleBlur);
      paintCannon.removeEventListener("focus", handleFocus);
      paintCannon.removeEventListener("clipboardWrite", handleClipboardWrite);
    };
  }, [paintCannon]);
  const scrollTranscriptToBottom = useCallback(() => {
    if (followTranscriptRef.current) scrollToBottom(transcriptRef.current);
  }, []);
  const scrollTranscriptToBottomIfNeeded = useCallback(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return false;
    if (keyboardScrollActiveRef.current) return true;
    if (
      isScrolledToBottom(transcript.scrollTop, transcript.scrollHeight, transcript.clientHeight)
    ) {
      return false;
    }

    followTranscriptRef.current = false;
    keyboardScrollActiveRef.current = true;
    keyboardScrollStartRef.current = transcript.scrollTop;
    setIsKeyboardScrollActive(true);
    return true;
  }, []);
  useLayoutEffect(() => {
    if (!isKeyboardScrollActive) return;
    const transcript = transcriptRef.current;
    if (!transcript) {
      keyboardScrollActiveRef.current = false;
      setIsKeyboardScrollActive(false);
      return;
    }

    const progress = Math.min(1, keyboardScrollTime / KEYBOARD_SCROLL_DURATION_MS);
    const easedProgress = 1 - Math.pow(1 - progress, 3);
    const targetScrollTop = Math.max(0, transcript.scrollHeight - transcript.clientHeight);
    transcript.scrollTop =
      keyboardScrollStartRef.current +
      (targetScrollTop - keyboardScrollStartRef.current) * easedProgress;

    if (progress === 1) {
      keyboardScrollActiveRef.current = false;
      followTranscriptRef.current = true;
      transcript.scrollTop = targetScrollTop;
      setIsKeyboardScrollActive(false);
    }
  }, [isKeyboardScrollActive, keyboardScrollTime]);
  const [currConfig, setCurrConfig] = useState(config);
  const [session, setSession] = useState(initialSession);
  const handleSessionChange = useCallback(
    (nextSession: Session) => {
      if (nextSession === session) return;
      setSession(nextSession);
      onSessionChange(nextSession);
    },
    [onSessionChange, session],
  );
  const [isUnchained, setIsUnchained] = useState(unchained);
  const [tempNotification, setTempNotification] = useState<string | null>(
    isUnchained ? UNCHAINED_NOTIF : CHAINED_NOTIF,
  );
  const {
    history,
    modeData,
    menuOpen,
    clearNonce,
    sessionHydrationNonce,
    modelOverride,
    cancelNotifyReadyForInput,
    query,
  } = useAppStore(
    useShallow(state => ({
      history: state.history,
      modeData: state.modeData,
      menuOpen: state.menuOpen,
      clearNonce: state.clearNonce,
      sessionHydrationNonce: state.sessionHydrationNonce,
      modelOverride: state.modelOverride,
      cancelNotifyReadyForInput: state.cancelNotifyReadyForInput,
      query: state.query,
    })),
  );
  useKeyboard(() => {
    cancelNotifyReadyForInput();
  });
  useEffect(() => {
    if (updates != null) markUpdatesSeen();
  }, []);
  const matchedModel =
    modelOverride == null ? null : matchModelFromConfig(currConfig, modelOverride);
  const matchedModelRef = useRef(matchedModel);
  matchedModelRef.current = matchedModel;
  useEffect(() => {
    if (modelOverride == null) return;
    if (matchedModelRef.current != null) return;
    const sessionModel = tryDeserializeModelJson(modelOverride);
    const modelDescription = sessionModel ? `"${sessionModel.nickname},"` : "a model";
    showToast(
      <Span style={{ color: "red" }}>
        {`This session used ${modelDescription} which is no longer in your config. Falling back to the default model.`}
      </Span>,
    );
  }, [matchedModelRef, sessionHydrationNonce, showToast]);
  const skillNotifs: string[] = [];
  if (bootSkills.length > 0) {
    skillNotifs.push(" ");
    skillNotifs.push("Configured skills:");
    skillNotifs.push(...bootSkills.map(s => `- ${s}`));
  }
  const bootItems: TranscriptItem[] = useMemo(() => {
    const items = [
      {
        type: "header" as const,
      },
      {
        type: "version" as const,
        metadata,
      },
      ...skillNotifs.map(s => ({
        type: "boot-notification" as const,
        content: s,
      })),
      ...(updates
        ? [
            {
              type: "updates" as const,
              updates,
            },
          ]
        : []),
    ];
    return items;
  }, [metadata, skillNotifs, updates]);
  const inflightResponse =
    modeData.mode === "responding" || modeData.mode === "compacting"
      ? modeData.inflightResponse
      : null;
  useLayoutEffect(() => {
    scrollTranscriptToBottom();
  }, [
    clearNonce,
    history.length,
    inflightResponse?.content,
    inflightResponse?.reasoningContent,
    modeData.mode,
    bootItems.length,
    query,
    scrollTranscriptToBottom,
  ]);
  useEffect(() => {
    let resizeFrame: number | undefined;
    const handleResize = () => {
      if (!followTranscriptRef.current) return;
      if (resizeFrame !== undefined) paintCannon.cancelAnimationFrame(resizeFrame);
      resizeFrame = paintCannon.requestAnimationFrame(() => {
        resizeFrame = undefined;
        scrollTranscriptToBottom();
      });
    };

    paintCannon.addEventListener("resize", handleResize);
    return () => {
      paintCannon.removeEventListener("resize", handleResize);
      if (resizeFrame !== undefined) paintCannon.cancelAnimationFrame(resizeFrame);
    };
  }, [paintCannon, scrollTranscriptToBottom]);
  const appScrollbarColor = hasFocus ? SCROLLBAR_COLOR : DIMMED_SCROLLBAR_COLOR;
  return (
    <ScrollTranscriptToBottomContext.Provider value={scrollTranscriptToBottomIfNeeded}>
      <ReactDevelopmentBuildToast />
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
                  <SessionContext.Provider value={session}>
                    <CwdContext.Provider value={cwd}>
                      <ExitOnDoubleCtrlC>
                        <AppShell>
                          <TerminalFlex
                            ref={transcriptRef}
                            onScroll={event => {
                              followTranscriptRef.current = isScrolledToBottom(
                                event.scrollTop,
                                event.scrollHeight,
                                transcriptRef.current?.clientHeight ?? 1,
                              );
                            }}
                            style={{
                              flexDirection: "column",
                              flexGrow: 1,
                              flexShrink: 1,
                              flexBasis: 0,
                              minWidth: 0,
                              minHeight: 0,
                              overflowY: "scroll",
                              scrollbarGutter: "stable",
                              scrollbarColor: appScrollbarColor,
                            }}
                          >
                            <TerminalFlex
                              style={{
                                flexDirection: "column",
                                minHeight: "100%",
                                flexShrink: 0,
                                overflowWrap: "anywhere",
                              }}
                            >
                              <TerminalFlex
                                style={{
                                  flexDirection: "column",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  width: "100%",
                                  flexGrow: 1,
                                  flexShrink: 1,
                                  marginTop: 1,
                                  marginBottom: 1,
                                }}
                              >
                                {bootItems.map((item, index) => (
                                  <TranscriptItemRenderer item={item} key={`boot-${index}`} />
                                ))}
                              </TerminalFlex>
                              <TranscriptItemRenderer item={{ type: "slogan" }} />
                              <TerminalFlex
                                key={clearNonce}
                                style={{
                                  flexDirection: "column",
                                }}
                              >
                                {history.map((item, index) => (
                                  <TranscriptItemRenderer
                                    item={{
                                      type: "history-item",
                                      item,
                                    }}
                                    key={`history-${index}`}
                                  />
                                ))}
                                {(modeData.mode === "responding" ||
                                  modeData.mode === "compacting") &&
                                  (modeData.inflightResponse.reasoningContent ||
                                    modeData.inflightResponse.content) && (
                                    <MessageDisplay item={modeData.inflightResponse} />
                                  )}
                                {(modeData.mode === "tool-call" ||
                                  modeData.mode === "tool-call-permission") &&
                                  !menuOpen && (
                                    <ToolRequestsRenderer
                                      toolReqs={modeData.toolReqs}
                                      config={currConfig}
                                      transport={transport}
                                      session={session}
                                      onContentLayout={scrollTranscriptToBottom}
                                    />
                                  )}
                              </TerminalFlex>
                            </TerminalFlex>
                          </TerminalFlex>
                          <BottomBar
                            inputHistory={inputHistory}
                            metadata={metadata}
                            tempNotification={tempNotification}
                          />
                        </AppShell>
                      </ExitOnDoubleCtrlC>
                      {menuOpen && (
                        <Modal minWidth={50}>
                          <Menu onSessionChange={handleSessionChange} />
                        </Modal>
                      )}
                    </CwdContext.Provider>
                  </SessionContext.Provider>
                </TransportContext.Provider>
              </UnchainedContext.Provider>
            </ConfigContext.Provider>
          </ConfigPathContext.Provider>
        </SetConfigContext.Provider>
      </InputPriorityProvider>
    </ScrollTranscriptToBottomContext.Provider>
  );
}
function BottomBar({
  inputHistory,
  metadata,
  tempNotification,
}: {
  inputHistory: InputHistory;
  metadata: Metadata;
  tempNotification: string | null;
}) {
  const TEMP_NOTIFICATION_DURATION = 5000;
  const [versionCheck, setVersionCheck] = useState("Checking for updates...");
  const [displayedTempNotification, setDisplayedTempNotification] =
    useState<React.ReactNode | null>(null);
  const themeColor = useColor();
  const ctrlCPressed = useCtrlCPressed();
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
  return (
    <TerminalFlex style={{ flexDirection: "column", width: "100%" }}>
      <BottomBarContent inputHistory={inputHistory} />
      <TerminalFlex
        style={{
          width: "100%",
          justifyContent: "space-between",
          height: 1,
          flexShrink: 0,
          flexGrow: 1,
        }}
      >
        <TerminalFlex style={{ height: 1 }}>
          <Span style={{ color: themeColor }}>{ctrlCPressed && "Press Ctrl+C again to exit."}</Span>
          {!ctrlCPressed && (
            <Span style={{ color: "gray" }}>
              {unchained ? "⚡ Unchained mode" : "Collaboration mode"}{" "}
              <Span style={{ color: "gray" }}>(Shift+Tab to toggle)</Span>
            </Span>
          )}
        </TerminalFlex>
        <Span
          style={{
            color: themeColor,
            visibility: versionCheck === "" ? "hidden" : "visible",
          }}
        >
          {versionCheck}
        </Span>
      </TerminalFlex>

      <TerminalFlex style={{ minHeight: 1 }}>
        {displayedTempNotification && (
          <TerminalFlex style={{ width: "100%", flexShrink: 0 }}>
            <Span style={{ color: themeColor, whiteSpace: "pre-wrap" }}>
              {displayedTempNotification}
            </Span>
          </TerminalFlex>
        )}
      </TerminalFlex>
    </TerminalFlex>
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
function QueuedUserMessages({ messages }: { messages: readonly QueuedUserMessage[] }) {
  if (messages.length === 0) return null;
  const preview = excerpt(messages.map(m => m.content.split("\n")[0]).join(" · "));
  return (
    <Span
      style={{
        color: "gray",
      }}
    >
      Queued ({messages.length}): {preview}
    </Span>
  );
}

function useInputMode({
  vimEnabled,
  modeData,
  clearNonce,
}: {
  vimEnabled: boolean;
  modeData: UiState["modeData"];
  clearNonce: number;
}) {
  const inputAvailable = inputFieldAvailable(modeData);
  const [vimMode, setVimMode] = useState<VimMode>("INSERT");

  useEffect(() => {
    if (!vimEnabled) return;
    if (inputAvailable) setVimMode("INSERT");
  }, [clearNonce, inputAvailable, vimEnabled]);

  const inputMode: InputMode = vimEnabled
    ? { kind: "vim", mode: inputAvailable ? vimMode : "NORMAL" }
    : DEFAULT_INPUT_MODE;
  const inputSubmitted = useCallback(() => {
    if (vimEnabled) setVimMode("INSERT");
  }, [vimEnabled]);

  return { inputMode, setVimMode, inputSubmitted };
}

function BottomBarContent({ inputHistory }: { inputHistory: InputHistory }) {
  const config = useConfig();
  const model = useModel();
  const transport = useContext(TransportContext);
  const session = useSession();
  const showToast = useToast();
  const {
    modeData,
    clearNonce,
    menuOpen,
    input,
    abortResponse,
    openMenu,
    closeMenu,
    byteCount,
    query,
    setQuery,
    attachedImages,
    addAttachedImage,
    removeLastAttachedImage,
    clearAttachedImages,
    queuedMessages,
    queueMessage,
  } = useAppStore(
    useShallow(state => ({
      modeData: state.modeData,
      clearNonce: state.clearNonce,
      menuOpen: state.menuOpen,
      input: state.input,
      abortResponse: state.abortResponse,
      closeMenu: state.closeMenu,
      openMenu: state.openMenu,
      byteCount: state.byteCount,
      query: state.query,
      setQuery: state.setQuery,
      attachedImages: state.attachedImages,
      addAttachedImage: state.addAttachedImage,
      removeLastAttachedImage: state.removeLastAttachedImage,
      clearAttachedImages: state.clearAttachedImages,
      queuedMessages: state.queuedUserMessages,
      queueMessage: state.enqueueUserMessage,
    })),
  );

  const { inputMode, setVimMode, inputSubmitted } = useInputMode({
    vimEnabled: !!config.vimEmulation?.enabled,
    modeData,
    clearNonce,
  });

  useCtrlC(() => {
    if (inputMode.kind === "vim" || menuOpen) return;
    setQuery("");
  });
  useKeyboard(event => {
    if (menuOpen) return;
    if (event.key === "Escape") {
      if (event.defaultPrevented) return;
      // Vim INSERT mode: Esc ONLY returns to NORMAL (no menu, no abort)
      if (inputMode.kind === "vim" && inputMode.mode === "INSERT") {
        setVimMode("NORMAL");
        return;
      }
      abortResponse(session, config);
      closeMenu();
    }
    if (event.ctrlKey && event.key === "p") {
      openMenu();
    }
  });
  const color = useColor();
  const onSubmit = useCallback(
    async (submittedQuery?: string, images?: ImageInfo[]) => {
      const finalQuery = submittedQuery ?? query;
      inputSubmitted();
      setQuery("");
      if (modeData.mode !== "ready-for-request") {
        queueMessage({ content: finalQuery, images });
        return;
      }
      try {
        await input({
          query: finalQuery,
          config,
          transport,
          session,
          images,
        });
      } catch (error) {
        if (error instanceof SessionNotFoundError) {
          showToast(
            <Span style={{ color: "red" }}>
              Could not send message. Session {error.sessionId} does not exist.
            </Span>,
          );
          return;
        }
        throw error;
      }
    },
    [query, modeData.mode, config, transport, session, setQuery, showToast, inputSubmitted],
  );
  if (
    modeData.mode === "responding" ||
    modeData.mode === "compacting" ||
    modeData.mode === "diff-apply" ||
    modeData.mode === "fix-json" ||
    modeData.mode === "tool-call"
  ) {
    const overrideStrings = (() => {
      if (modeData.mode === "compacting") return ["Compacting history to save context tokens"];
      if (modeData.mode === "diff-apply") return ["Auto-fixing diff"];
      if (modeData.mode === "fix-json") return ["Auto-fixing JSON"];
      return undefined;
    })();
    return (
      <TerminalFlex
        style={{
          flexDirection: "column",
        }}
      >
        <TerminalFlex
          style={{
            justifyContent: "space-between",
          }}
        >
          <Loading overrideStrings={overrideStrings} />
          <TerminalFlex>
            {byteCount === 0 ? null : (
              <Span
                style={{
                  color: color,
                }}
              >
                ⇩ {byteCount} bytes
              </Span>
            )}
            <Span> </Span>
            <Span
              style={{
                color: "gray",
              }}
            >
              (Press ESC to interrupt)
            </Span>
          </TerminalFlex>
        </TerminalFlex>
        <QueuedUserMessages messages={queuedMessages} />
        <MultimediaInput
          focus={!menuOpen}
          inputHistory={inputHistory}
          value={query}
          onChange={setQuery}
          attachedImages={attachedImages}
          addAttachedImage={addAttachedImage}
          removeLastAttachedImage={removeLastAttachedImage}
          clearAttachedImages={clearAttachedImages}
          onSubmit={onSubmit}
          inputMode={inputMode}
          setVimMode={setVimMode}
          modalities={model.modalities}
        />
        <VimModeIndicator inputMode={inputMode} />
      </TerminalFlex>
    );
  }
  if (modeData.mode === "error-recovery") return <Loading />;
  if (modeData.mode === "payment-error") {
    return <PaymentErrorScreen error={modeData.error} />;
  }
  if (modeData.mode === "rate-limit-error") {
    return <RateLimitErrorScreen error={modeData.error} />;
  }
  if (modeData.mode === "auth-error") {
    return (
      <AuthErrorScreen
        model={modeData.model}
        error={modeData.error}
        config={config}
        transport={transport}
        session={session}
      />
    );
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
  if (modeData.mode === "tool-call-permission") return null;
  const _: "ready-for-request" = modeData.mode;
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
      }}
    >
      <TerminalFlex
        style={{
          marginLeft: 1,
          justifyContent: "space-between",
        }}
      >
        <Span
          style={{
            color: "gray",
          }}
        >
          Model: {model.nickname}
        </Span>
        <Span
          style={{
            color: "gray",
          }}
        >
          (Ctrl+p to enter the menu)
        </Span>
      </TerminalFlex>
      <QueuedUserMessages messages={queuedMessages} />
      <MultimediaInput
        focus={!menuOpen}
        inputHistory={inputHistory}
        value={query}
        onChange={setQuery}
        attachedImages={attachedImages}
        addAttachedImage={addAttachedImage}
        removeLastAttachedImage={removeLastAttachedImage}
        clearAttachedImages={clearAttachedImages}
        onSubmit={onSubmit}
        inputMode={inputMode}
        setVimMode={setVimMode}
        modalities={model.modalities}
      />
      <VimModeIndicator inputMode={inputMode} />
    </TerminalFlex>
  );
}
function AuthErrorScreen({
  model,
  error,
  config,
  transport,
  session,
}: {
  model: Config["models"][number];
  error: AuthError;
  config: Config;
  transport: Transport;
  session: Session;
}) {
  const setConfig = useSetConfig();
  const { runAgent, clearAuthError } = useAppStore(
    useShallow(state => ({
      runAgent: state.runAgent,
      clearAuthError: state.clearAuthError,
    })),
  );
  const [authError, setAuthError] = useState<AuthError | null>(error);
  const resolveModelIndex = useCallback(
    (models: Config["models"]) => {
      return models.findIndex(candidate => {
        if (model.type === "codex") {
          return (
            candidate.type === "codex" &&
            candidate.nickname === model.nickname &&
            candidate.model === model.model
          );
        }
        if (candidate.type === "codex") return false;
        return (
          candidate.nickname === model.nickname &&
          candidate.baseUrl === model.baseUrl &&
          candidate.model === model.model
        );
      });
    },
    [model],
  );
  const onComplete = useCallback(
    async (auth?: Auth) => {
      let updatedConfig = config;
      let updatedModel = model;
      const index = resolveModelIndex(config.models);
      if (index >= 0) {
        updatedModel = config.models[index];
      }
      if (auth && index >= 0) {
        if (updatedModel.type === "codex") {
          if (auth.type !== "codex") {
            setAuthError({
              type: "invalid",
              message: "Codex models can only use Codex OAuth auth.",
            });
            return;
          }
          const updatedModels = [...config.models];
          updatedModel = {
            ...updatedModel,
            auth,
          };
          updatedModels[index] = updatedModel;
          updatedConfig = {
            ...config,
            models: updatedModels,
          };
        } else {
          if (auth.type === "codex") {
            setAuthError({
              type: "invalid",
              message: "API-key models cannot use Codex OAuth auth.",
            });
            return;
          }
          if (auth.type === "env") {
            updatedConfig = mergeEnvVar(config, updatedModel, auth.name);
          } else {
            const updatedModels = [...config.models];
            updatedModel = {
              ...updatedModel,
              auth,
            };
            updatedModels[index] = updatedModel;
            updatedConfig = {
              ...config,
              models: updatedModels,
            };
          }
        }
        await setConfig(updatedConfig);
      }
      const updatedIndex = resolveModelIndex(updatedConfig.models);
      if (updatedIndex >= 0) {
        updatedModel = updatedConfig.models[updatedIndex];
      }
      const result = await readAuthForModel(updatedModel, updatedConfig);
      if (!result.ok) {
        setAuthError(result.error);
        return;
      }
      await runAgent({
        config: updatedConfig,
        transport,
        session,
      });
    },
    [config, model, resolveModelIndex, runAgent, setConfig, transport, session],
  );
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
        gap: 1,
      }}
    >
      <CenteredBox>
        <TerminalFlex
          style={{
            flexDirection: "column",
            gap: 1,
          }}
        >
          <TerminalFlex
            style={{
              justifyContent: "center",
            }}
          >
            <Span
              style={{
                color: "red",
              }}
            >
              Auth is required for {model.nickname}
            </Span>
          </TerminalFlex>
          {authError && (
            <TerminalFlex
              style={{
                justifyContent: "center",
              }}
            >
              <Span
                style={{
                  color: "yellow",
                }}
              >
                {authError.message}
              </Span>
            </TerminalFlex>
          )}
        </TerminalFlex>
      </CenteredBox>
      <CustomAuthFlow
        config={config}
        authData={
          model.type === "codex"
            ? {
                modelType: "codex",
              }
            : {
                modelType: model.type,
                baseUrl: model.baseUrl,
              }
        }
        onComplete={onComplete}
        onCancel={clearAuthError}
      />
    </TerminalFlex>
  );
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
  const themeColor = useColor();
  const session = useSession();
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
  const [wroteCurl, setWroteCurl] = useState(false);
  const [curlFilePath, setCurlFilePath] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const mapping: Record<
    string,
    Item<"view" | "copy-curl" | "write-curl" | "retry" | "edit-retry" | "quit">
  > = {};
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
    mapping["w"] = {
      label: wroteCurl ? "Wrote cURL to file!" : "Write cURL to file",
      value: "write-curl",
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
  const shortcutItems: ShortcutArray<
    "view" | "copy-curl" | "write-curl" | "retry" | "edit-retry" | "quit"
  > = [
    {
      type: "key" as const,
      mapping,
    },
  ];
  const onSelect = useCallback(
    (item: Item<"view" | "copy-curl" | "write-curl" | "retry" | "edit-retry" | "quit">) => {
      if (item.value === "view") {
        setViewError(true);
      } else if (item.value === "copy-curl") {
        try {
          clipboardy.writeSync(curlCommand || "Failed to generate cURL command");
          setCopiedCurl(true);
        } catch (error) {
          setClipboardError(error instanceof Error ? error.message : "Failed to copy to clipboard");
        }
      } else if (item.value === "write-curl") {
        try {
          const filePath = path.join(os.tmpdir(), "octo-curl-request.sh");
          writeFileSync(filePath, curlCommand || "Failed to generate cURL command");
          setCurlFilePath(filePath);
          setWroteCurl(true);
        } catch (error) {
          setWriteError(error instanceof Error ? error.message : "Failed to write cURL to file");
        }
      } else if (item.value === "retry") {
        retryFrom(mode, {
          config,
          transport,
          session,
        });
      } else if (item.value === "edit-retry") {
        editAndRetryFrom(mode, {
          config,
          transport,
          session,
        });
      } else {
        const _: "quit" = item.value;
        exit();
      }
    },
    [curlCommand, mode, config, transport, session],
  );
  return (
    <KbShortcutPanel title="" shortcutItems={shortcutItems} onSelect={onSelect}>
      <Span
        style={{
          color: "red",
        }}
      >
        {contextualMessage}
      </Span>
      {viewError && (
        <TerminalFlex
          style={{
            marginTop: 1,
            marginBottom: 1,
          }}
        >
          <Span>{error}</Span>
        </TerminalFlex>
      )}
      {copiedCurl && (
        <TerminalFlex
          style={{
            marginTop: 1,
            marginBottom: 1,
          }}
        >
          <Span>{curlCommand}</Span>
        </TerminalFlex>
      )}
      {clipboardError && (
        <TerminalFlex
          style={{
            marginTop: 1,
            marginBottom: 1,
          }}
        >
          <Span
            style={{
              color: "red",
            }}
          >
            {clipboardError}
          </Span>
        </TerminalFlex>
      )}
      {wroteCurl && curlFilePath && (
        <TerminalFlex
          style={{
            marginTop: 1,
            marginBottom: 1,
          }}
        >
          <Span>
            Wrote cURL to{" "}
            <Span
              style={{
                color: themeColor,
              }}
            >
              {curlFilePath}
            </Span>
          </Span>
        </TerminalFlex>
      )}
      {writeError && (
        <TerminalFlex
          style={{
            marginTop: 1,
            marginBottom: 1,
          }}
        >
          <Span
            style={{
              color: "red",
            }}
          >
            {writeError}
          </Span>
        </TerminalFlex>
      )}
    </KbShortcutPanel>
  );
}
function RateLimitErrorScreen({ error }: { error: string }) {
  const config = useConfig();
  const transport = useContext(TransportContext);
  const session = useSession();
  const { retryFrom } = useAppStore(
    useShallow(state => ({
      retryFrom: state.retryFrom,
    })),
  );
  useKeyboard(() => {
    retryFrom("rate-limit-error", {
      config,
      transport,
      session,
    });
  });
  return (
    <CenteredBox>
      <Span
        style={{
          color: "red",
        }}
      >
        It looks like you've hit a rate limit! Here's the error from the backend:
      </Span>
      <Span>{error}</Span>
      <Span
        style={{
          color: "gray",
        }}
      >
        Press any key when you're ready to retry.
      </Span>
    </CenteredBox>
  );
}
function PaymentErrorScreen({ error }: { error: string }) {
  const config = useConfig();
  const transport = useContext(TransportContext);
  const session = useSession();
  const { retryFrom } = useAppStore(
    useShallow(state => ({
      retryFrom: state.retryFrom,
    })),
  );
  useKeyboard(() => {
    retryFrom("payment-error", {
      config,
      transport,
      session,
    });
  });
  return (
    <CenteredBox>
      <Span
        style={{
          color: "red",
        }}
      >
        Payment error:
      </Span>
      <Span>{error}</Span>
      <Span
        style={{
          color: "gray",
        }}
      >
        Once you've paid, press any key to continue.
      </Span>
    </CenteredBox>
  );
}
const ToolRequestItem = ({
  isSelected = false,
  label,
  whitelistAllowDescription,
}: {
  isSelected?: boolean;
  label: string;
  whitelistAllowDescription?: React.ReactNode;
}) => {
  const themeColor = useColor();
  return (
    <Span
      style={{
        color: isSelected ? themeColor : undefined,
      }}
    >
      {label}
      {whitelistAllowDescription}
    </Span>
  );
};
function ToolRequestsRenderer({
  toolReqs,
  config,
  transport,
  session,
  onContentLayout,
}: {
  toolReqs: ToolCallRequest[];
  onContentLayout: () => void;
} & RunArgs) {
  const runAgent = useAppStore(state => state.runAgent);
  const { history, runningToolCallId } = useAppStore(
    useShallow(state => ({
      history: state.history,
      runningToolCallId: state.runningToolCallId,
    })),
  );
  /*
   * Derive the current action from history rather than tracking a cursor in component state:
   * this component unmounts when the menu opens, and a cursor would reset to 0 on remount,
   * re-running tools that already executed.
   */
  const action = nextToolAction(toolReqs, runningToolCallId, history);
  const actionKey = action.kind === "done" ? "done" : `${action.kind}:${action.req.toolCallId}`;
  useLayoutEffect(() => {
    onContentLayout();
  }, [actionKey, onContentLayout]);
  if (action.kind === "done") {
    return (
      <FinishToolRequests
        runAgent={runAgent}
        config={config}
        transport={transport}
        session={session}
      />
    );
  }
  const currentToolReq = action.req;
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
      }}
    >
      <ToolMessageRenderer item={currentToolReq} />
      <ToolRequestRenderer
        toolReq={currentToolReq}
        config={config}
        transport={transport}
        session={session}
        onContentLayout={onContentLayout}
      />
    </TerminalFlex>
  );
}
function FinishToolRequests({
  runAgent,
  config,
  transport,
  session,
}: {
  runAgent: (args: RunArgs) => Promise<void>;
} & RunArgs) {
  useEffect(() => {
    runAgent({
      config,
      transport,
      session,
    });
  }, [runAgent, config, transport, session]);
  return <Loading />;
}
function ToolRequestRenderer({
  toolReq,
  config,
  transport,
  session,
  onContentLayout,
}: {
  toolReq: ToolCallRequest;
  onContentLayout: () => void;
} & RunArgs) {
  const themeColor = useColor();
  const scrollTranscriptToBottomIfNeeded = useScrollTranscriptToBottom();
  const { runTool, rejectTool, addToWhitelist, notifyReadyForInput, requestToolPermission } =
    useAppStore(
      useShallow(state => ({
        runTool: state.runTool,
        rejectTool: state.rejectTool,
        addToWhitelist: state.addToWhitelist,
        notifyReadyForInput: state.notifyReadyForInput,
        requestToolPermission: state.requestToolPermission,
      })),
    );
  const unchained = useUnchained();
  const whitelistKey = (() => {
    const fn = parsedToolSchema(toolReq);
    switch (fn.name) {
      case "read":
      case "partial-read":
      case "list":
        return "read:*";
      case "create":
      case "rewrite":
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
    return `${fn.name}:*`;
  })();
  const isToolWhitelisted = useAppStore(state => state.whitelist.has(whitelistKey));
  const prompt = (() => {
    const fn = parsedToolSchema(toolReq);
    switch (fn.name) {
      case "create":
        return (
          <TerminalFlex>
            <Span>Create file </Span>
            <Span
              style={{
                color: themeColor,
              }}
            >
              {fn.arguments.filePath}
            </Span>
            <Span>?</Span>
          </TerminalFlex>
        );
      case "rewrite":
      case "edit":
        return (
          <TerminalFlex>
            <Span>Make these changes to </Span>
            <Span
              style={{
                color: themeColor,
              }}
            >
              {fn.arguments.filePath}
            </Span>
            <Span>?</Span>
          </TerminalFlex>
        );
      case "skill":
      case "read":
      case "partial-read":
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
    return null;
  })();
  const toolName = toolReq.name;
  type SelectItem = {
    label: string;
    value: string;
    whitelistAllowDescription?: React.ReactNode;
  };
  const items: SelectItem[] = [
    {
      label: "Yes",
      value: "yes",
    },
    ...(!SKIP_CONFIRMATION_TOOLS.includes(toolName) &&
    !ALWAYS_REQUEST_PERMISSION_TOOLS.includes(toolName) &&
    !isToolWhitelisted
      ? [
          {
            label: "Yes, and always allow",
            value: "yes-whitelist",
            whitelistAllowDescription: <WhitelistAllowDescription toolCallRequest={toolReq} />,
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
        rejectTool(toolReq, { config, transport, session });
      } else if (item.value === "yes-whitelist") {
        const pendingToolRun = runTool({
          toolReq,
          config,
          transport,
          session,
        });
        await addToWhitelist(whitelistKey);
        await pendingToolRun;
      } else {
        await runTool({
          toolReq,
          config,
          transport,
          session,
        });
      }
    },
    [toolReq, config, transport, session, addToWhitelist, runTool, rejectTool, whitelistKey],
  );
  const runningToolCallId = useAppStore(state => state.runningToolCallId);
  const isRunning = runningToolCallId === toolReq.toolCallId;
  const noConfirmationNeeded =
    unchained || SKIP_CONFIRMATION_TOOLS.includes(toolReq.name) || isToolWhitelisted;
  useLayoutEffect(() => {
    if (!isRunning && !noConfirmationNeeded) requestToolPermission();
    onContentLayout();
  }, [isRunning, noConfirmationNeeded, requestToolPermission, onContentLayout]);
  useEffect(() => {
    // Already in flight (e.g. remounted mid-run after the menu closed): render progress without
    // re-invoking the tool.
    if (isRunning) return;
    if (noConfirmationNeeded) {
      runTool({
        toolReq,
        config,
        transport,
        session,
      });
    } else {
      notifyReadyForInput(config);
    }
  }, [
    toolReq,
    isRunning,
    noConfirmationNeeded,
    config,
    transport,
    session,
    runTool,
    notifyReadyForInput,
  ]);
  if (noConfirmationNeeded || isRunning) {
    return null;
  }
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
        gap: 1,
      }}
    >
      {prompt}
      <SelectInput
        items={items}
        onSelect={onSelect}
        onKeyDown={event => {
          // If you're scrolled offscreen during the permission prompt rendering, Enter should not
          // accept the permission request, and should instead scroll to the bottom
          if (event.key === "Enter" && scrollTranscriptToBottomIfNeeded()) {
            event.preventDefault();
          }
        }}
        indicatorComponent={IndicatorComponent}
        itemComponent={ToolRequestItem}
      />
    </TerminalFlex>
  );
}
const TranscriptItemRenderer = React.memo(({ item }: { item: TranscriptItem }) => {
  const themeColor = useColor();
  const unchained = useUnchained();
  if (item.type === "header") return <Header unchained={unchained} />;
  if (item.type === "version") {
    return (
      <TerminalFlex
        style={{
          marginTop: 1,
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <Span
          style={{
            color: "gray",
          }}
        >
          Version: {item.metadata.version}
        </Span>
      </TerminalFlex>
    );
  }
  if (item.type === "slogan") {
    return (
      <TerminalFlex
        style={{
          marginLeft: 1,
          marginTop: 1,
        }}
      >
        <Span>
          Octo is your friend. Tell Octo{" "}
          <Span
            style={{
              color: themeColor,
            }}
          >
            what you want to do.
          </Span>
        </Span>
      </TerminalFlex>
    );
  }
  if (item.type === "updates") {
    return (
      <TerminalFlex
        style={{
          marginTop: 1,
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <Span
          style={{
            fontWeight: "bold",
          }}
        >
          Updates:
        </Span>
        <TerminalFlex
          style={{
            marginTop: 1,
            alignSelf: "stretch",
            minWidth: 0,
          }}
        >
          <Markdown markdown={item.updates} />
        </TerminalFlex>
        <Span
          style={{
            color: "gray",
          }}
        >
          Thanks for updating!
        </Span>
        <Span
          style={{
            color: "gray",
          }}
        >
          See the full changelog by running: `octo changelog`
        </Span>
      </TerminalFlex>
    );
  }
  if (item.type === "boot-notification") {
    return (
      <TerminalFlex>
        <Span
          style={{
            color: "gray",
          }}
        >
          {item.content}
        </Span>
      </TerminalFlex>
    );
  }
  return <MessageDisplay item={item.item} />;
});

const MessageDisplay = ({ item }: { item: HistoryNode | InflightResponseType }) => {
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
        paddingRight: 4,
      }}
    >
      <MessageDisplayInner item={item} />
    </TerminalFlex>
  );
};
const MessageDisplayInner = ({ item }: { item: HistoryNode | InflightResponseType }) => {
  const { modeData } = useAppStore(
    useShallow(state => ({
      modeData: state.modeData,
    })),
  );
  if (item.type === "inflight-response") {
    return renderInflightResponse(item, modeData.mode === "compacting");
  }
  if (item.type === "notification") {
    return (
      <TerminalFlex
        style={{
          marginLeft: 1,
        }}
      >
        <Span
          style={{
            color: "gray",
          }}
        >
          {item.content}
        </Span>
      </TerminalFlex>
    );
  }
  if (item.type === "llm-ir") {
    return renderLlmIR(item.ir, modeData.mode === "compacting");
  }
  if (item.type === "request-failed") {
    return (
      <Span
        style={{
          color: "red",
        }}
      >
        Request failed.
      </Span>
    );
  }
  if (item.type === "compaction-failed") {
    return (
      <Span
        style={{
          color: "red",
        }}
      >
        Compaction failed.
      </Span>
    );
  }
  const _: never = item;
  return null;
};
function renderInflightResponse(item: InflightResponseType, isCompacting: boolean) {
  if (isCompacting) {
    return (
      <TerminalFlex
        style={{
          marginBottom: 1,
        }}
      >
        <CompactionRenderer item={item} />
      </TerminalFlex>
    );
  }
  return (
    <TerminalFlex
      style={{
        marginBottom: 1,
      }}
    >
      <AssistantMessageRenderer item={item} />
    </TerminalFlex>
  );
}
function renderLlmIR(item: OctoIR, isCompacting: boolean) {
  if (item.role === "assistant") {
    if (isCompacting) {
      return (
        <TerminalFlex
          style={{
            marginBottom: 1,
          }}
        >
          <CompactionRenderer item={item} />
        </TerminalFlex>
      );
    }
    return (
      <TerminalFlex
        style={{
          marginBottom: 1,
        }}
      >
        <AssistantMessageRenderer item={item} />
      </TerminalFlex>
    );
  }
  if (item.role === "tool-parse-error") {
    return (
      <Span
        style={{
          color: "red",
        }}
      >
        {displayLog({
          verbose: `Error: ${item.malformedRequest.error}`,
          info: "Malformed tool call. Retrying...",
        })}
      </Span>
    );
  }
  if (item.role === "tool-validation-error") {
    const message = (() => {
      if (item.aborted) return "Tool call aborted.";
      return "Tool call failed validation checks. Retrying...";
    })();
    return (
      <Span
        style={{
          color: "red",
        }}
      >
        {displayLog({
          verbose: `Error: ${item.error}`,
          info: message,
        })}
      </Span>
    );
  }
  if (item.role === "tool-runtime-error") {
    return (
      <TerminalFlex
        style={{
          flexDirection: "column",
        }}
      >
        <TerminalFlex
          style={{
            marginLeft: 2,
          }}
        >
          <Span
            style={{
              color: "red",
            }}
          >
            {displayLog({
              verbose: `Error: ${item.error}`,
              info: "Tool failed...",
            })}
          </Span>
        </TerminalFlex>
      </TerminalFlex>
    );
  }
  if (item.role === "tool-reject") {
    return (
      <TerminalFlex
        style={{
          flexDirection: "column",
        }}
      >
        <ToolMessageRenderer item={item.toolCall} />
        <TerminalFlex
          style={{
            marginLeft: 2,
          }}
        >
          <Span>Tool rejected; tell Octo what to do instead:</Span>
        </TerminalFlex>
      </TerminalFlex>
    );
  }

  // Tool skips are tracked internally for explaining to LLMs, but are not shown to users
  if (item.role === "tool-skip-output") {
    return null;
  }
  if (item.role === "checkpoint") {
    return <CompactionSummaryRenderer content={item.content} />;
  }
  if (item.role === "tool-output") {
    return (
      <TerminalFlex
        style={{
          flexDirection: "column",
          marginBottom: 1,
        }}
      >
        <ToolMessageRenderer item={item.toolCall} />
        <ToolOutputContentRenderer content={item.content} />
      </TerminalFlex>
    );
  }
  if (item.role === "file-read") {
    return (
      <TerminalFlex
        style={{
          flexDirection: "column",
          marginBottom: 1,
        }}
      >
        <ToolMessageRenderer item={item.toolCall} />
        <ToolOutputContentRenderer
          content={[
            {
              type: "text",
              content: item.content,
            },
            ...(item.image
              ? [
                  {
                    type: "image" as const,
                    image: item.image,
                  },
                ]
              : []),
          ]}
        />
      </TerminalFlex>
    );
  }
  if (item.role === "file-mutate") {
    return (
      <TerminalFlex
        style={{
          flexDirection: "column",
          marginBottom: 1,
        }}
      >
        <ToolMessageRenderer item={item.toolCall} />
        <ToolOutputContentRenderer
          content={[
            {
              type: "text",
              content: item.content,
            },
          ]}
        />
      </TerminalFlex>
    );
  }
  if (item.role === "trajectory") {
    return null;
  }
  const _: "user" = item.role;
  const textParts = item.content.filter((part: Content["content"][number]) => part.type === "text");
  const imageParts = item.content.filter(
    (part: Content["content"][number]) => part.type === "image",
  );
  const contentLines = textParts.flatMap(part => part.content.split(LINE_SPLIT_REGEX));
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
        marginTop: 1,
        marginBottom: 1,
      }}
    >
      <TerminalFlex
        style={{
          flexDirection: "row",
        }}
      >
        <TerminalFlex
          style={{
            marginRight: 1,
            flexShrink: 0,
          }}
        >
          <Span
            style={{
              color: "white",
            }}
          >
            ▶
          </Span>
        </TerminalFlex>
        {imageParts.length > 0 && (
          <TerminalFlex
            style={{
              marginRight: 1,
            }}
          >
            <Span
              style={{
                color: "#111827",
                backgroundColor: "#e5e7eb",
              }}
            >
              ⟦ 📎 {imageParts.length} image{imageParts.length > 1 ? "s" : ""} attached ⟧
            </Span>
          </TerminalFlex>
        )}
        <TerminalFlex
          style={{
            flexDirection: "column",
          }}
        >
          {contentLines.map((line, i) => (
            <TerminalFlex key={i}>
              <Span>{line}</Span>
            </TerminalFlex>
          ))}
        </TerminalFlex>
      </TerminalFlex>
    </TerminalFlex>
  );
}
function CompactionSummaryRenderer({ content }: { content: Content["content"] }) {
  const color = useColor();
  const displayContent = content.map(part => {
    if (part.type === "image") return part;
    return {
      ...part,
      content: part.content.replace(/^<summary>/, "").replace(/<\/summary>$/, ""),
    };
  });
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
        marginTop: 1,
        marginBottom: 1,
      }}
    >
      <Span
        style={{
          color: "gray",
        }}
      >
        History compacted! Summary:{" "}
      </Span>
      <ContentRenderer content={displayContent} textColor="gray" />
      <Span
        style={{
          color: color,
        }}
      >
        Summary complete!
      </Span>
    </TerminalFlex>
  );
}
function ToolMessageRenderer({ item }: { item: ToolCallRequest | MalformedToolRequest }) {
  if (item.type === "malformed-tool-request") {
    return null;
  }
  switch (item.name) {
    case "read":
      return <ReadToolRenderer item={parsedToolSchema(item)} />;
    case "partial-read":
      return <PartialReadToolRenderer item={parsedToolSchema(item)} />;
    case "list":
      return <ListToolRenderer item={parsedToolSchema(item)} />;
    case "shell":
      return <ShellToolRenderer item={parsedToolSchema(item)} />;
    case "background-process":
      return <BackgroundProcessToolRenderer item={parsedToolSchema(item)} />;
    case "manage-background-process":
      return <ManageBackgroundProcessToolRenderer item={parsedToolSchema(item)} />;
    case "edit":
      return <EditToolRenderer item={parsedToolSchema(item)} />;
    case "create":
      return <CreateToolRenderer item={parsedToolSchema(item)} />;
    case "mcp":
      return <McpToolRenderer item={parsedToolSchema(item)} />;
    case "fetch":
      return <FetchToolRenderer item={parsedToolSchema(item)} />;
    case "rewrite":
      return <RewriteToolRenderer item={parsedToolSchema(item)} />;
    case "skill":
      return <SkillToolRenderer item={parsedToolSchema(item)} />;
    case "web-search":
      return <WebSearchToolRenderer item={parsedToolSchema(item)} />;
    case "glob":
      return <GlobRenderer item={parsedToolSchema(item)} />;
    case "grep":
      return <GrepRenderer item={parsedToolSchema(item)} />;
    case "lsp-definition":
    case "lsp-references":
    case "lsp-hover":
    case "lsp-diagnostics":
    case "lsp-document-symbol":
    case "lsp-implementation":
    case "lsp-incoming-calls":
    case "lsp-outgoing-calls":
      return <LspToolRenderer item={parsedToolSchema(item)} />;
  }
}
function parsedToolSchema(toolCall: ToolCallRequest): any {
  return {
    name: toolCall.name,
    arguments: toolCall.parsed,
  };
}
function GlobRenderer({ item }: { item: ParsedToolSchemaFrom<typeof glob> }) {
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
      }}
    >
      <Span
        style={{
          color: "gray",
        }}
      >
        Octo searched for files using a glob pattern:
      </Span>
      <GlobArg name="Path" arg={item.arguments.path} />
      <GlobArg name="Filename pattern" arg={item.arguments.includeName} />
      <GlobArg name="Path pattern" arg={item.arguments.includePath} />
      <GlobArg name="Max depth" arg={item.arguments.maxDepth} />
    </TerminalFlex>
  );
}
function GrepRenderer({ item }: { item: ParsedToolSchemaFrom<typeof grep> }) {
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
      }}
    >
      <Span
        style={{
          color: "gray",
        }}
      >
        Octo searched file contents:
      </Span>
      <GlobArg name="Pattern" arg={item.arguments.pattern} />
      <GlobArg name="Path" arg={item.arguments.path} />
      <GlobArg name="Case insensitive" arg={item.arguments.caseInsensitive} />
      <GlobArg name="Context lines" arg={item.arguments.context} />
      <GlobArg name="Max results" arg={item.arguments.maxResults} />
      <GlobArg name="Timeout" arg={item.arguments.timeout} />
    </TerminalFlex>
  );
}
function GlobArg({ name, arg }: { name: string; arg: string | number | boolean | undefined }) {
  const color = useColor();
  if (arg == null) return null;
  return (
    <Span>
      <Span
        style={{
          color: "gray",
        }}
      >
        {name}:
      </Span>{" "}
      <Span
        style={{
          color: color,
        }}
      >
        {arg}
      </Span>
    </Span>
  );
}
function WebSearchToolRenderer(_: { item: ParsedToolSchemaFrom<typeof webSearch> }) {
  return (
    <TerminalFlex>
      <Span
        style={{
          color: "gray",
        }}
      >
        Octo searched the web
      </Span>
    </TerminalFlex>
  );
}
function SkillToolRenderer({ item }: { item: ParsedToolSchemaFrom<typeof skill> }) {
  return (
    <TerminalFlex>
      <Span
        style={{
          color: "gray",
        }}
      >
        Octo read the {item.arguments.skillName} skill
      </Span>
    </TerminalFlex>
  );
}
function FetchToolRenderer({ item }: { item: ParsedToolSchemaFrom<typeof fetchTool> }) {
  return <ToolCallRow name={item.name}>{item.arguments.url}</ToolCallRow>;
}
function ShellToolRenderer({ item }: { item: ParsedToolSchemaFrom<typeof shell> }) {
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
      }}
    >
      <ToolCallRow name={item.name}>{item.arguments.cmd}</ToolCallRow>
      <Span
        style={{
          color: "gray",
        }}
      >
        timeout: {item.arguments.timeout}
      </Span>
    </TerminalFlex>
  );
}

function BackgroundProcessToolRenderer({
  item,
}: {
  item: ParsedToolSchemaFrom<typeof backgroundProcess>;
}) {
  return <ToolCallRow name={item.name}>{item.arguments.label ?? item.arguments.cmd}</ToolCallRow>;
}

function ManageBackgroundProcessToolRenderer({
  item,
}: {
  item: ParsedToolSchemaFrom<typeof manageBackgroundProcess>;
}) {
  return (
    <ToolCallRow name={item.name}>
      {item.arguments.label == null
        ? item.arguments.action
        : `${item.arguments.action} ${item.arguments.label}`}
    </ToolCallRow>
  );
}

function ReadToolRenderer({ item }: { item: ParsedToolSchemaFrom<typeof read> }) {
  return <ToolCallRow name={item.name}>{item.arguments.filePath}</ToolCallRow>;
}
function PartialReadToolRenderer({ item }: { item: ParsedToolSchemaFrom<typeof partialRead> }) {
  return (
    <ToolCallRow name={item.name}>
      {item.arguments.filePath}:{item.arguments.offset}-
      {item.arguments.offset + item.arguments.limit - 1}
    </ToolCallRow>
  );
}
function ListToolRenderer({ item }: { item: ParsedToolSchemaFrom<typeof list> }) {
  return <ToolCallRow name={item.name}>{item?.arguments?.dirPath || process.cwd()}</ToolCallRow>;
}
function EditToolRenderer({ item }: { item: ParsedToolSchemaFrom<typeof edit> }) {
  const themeColor = useColor();
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
      }}
    >
      <TerminalFlex>
        <Span>Edit: </Span>
        <Span
          style={{
            color: themeColor,
          }}
        >
          {item.arguments.filePath}
        </Span>
      </TerminalFlex>
      <DiffEditRenderer filePath={item.arguments.filePath} item={item.arguments} />
    </TerminalFlex>
  );
}
function RewriteToolRenderer({ item }: { item: ParsedToolSchemaFrom<typeof rewrite> }) {
  const { text, filePath, originalFileContents } = item.arguments;
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
        gap: 1,
      }}
    >
      <Span>Octo wants to rewrite the file:</Span>
      <DiffRenderer
        oldText={originalFileContents}
        newText={text}
        fileContents={originalFileContents}
        filepath={filePath}
      />
    </TerminalFlex>
  );
}
function DiffEditRenderer({
  item,
  filePath,
}: {
  item: t.GetType<typeof EditParsedSchema>;
  filePath: string;
}) {
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
      }}
    >
      <Span>Octo wants to make the following changes:</Span>
      <DiffRenderer
        oldText={item.search}
        newText={item.replace}
        fileContents={item.originalFileContents}
        filepath={filePath}
      />
    </TerminalFlex>
  );
}
function CreateToolRenderer({ item }: { item: ParsedToolSchemaFrom<typeof createTool> }) {
  const themeColor = useColor();
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
        gap: 1,
      }}
    >
      <TerminalFlex>
        <Span>Octo wants to create </Span>
        <Span
          style={{
            color: themeColor,
          }}
        >
          {item.arguments.filePath}
        </Span>
        <Span>:</Span>
      </TerminalFlex>
      <TerminalFlex>
        <FileRenderer contents={item.arguments.content} filePath={item.arguments.filePath} />
      </TerminalFlex>
    </TerminalFlex>
  );
}
function McpToolRenderer({ item }: { item: ParsedToolSchemaFrom<typeof mcp> }) {
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
      }}
    >
      <ToolCallRow name={item.name}>
        Server: {item.arguments.server}, Tool: {item.arguments.tool}
      </ToolCallRow>
      <Span
        style={{
          color: "gray",
        }}
      >
        Arguments: {JSON.stringify(item.arguments.arguments)}
      </Span>
    </TerminalFlex>
  );
}
function ToolOutputContentRenderer({ content }: { content: Content["content"] }) {
  const textParts = content.filter(part => part.type === "text");
  const imageParts = content.filter(part => part.type === "image");
  const lines = textParts.reduce(
    (count, part) => count + part.content.split(LINE_SPLIT_REGEX).length,
    0,
  );
  return (
    <TerminalFlex
      style={{
        marginLeft: 2,
        flexDirection: "column",
      }}
    >
      <Span
        style={{
          color: "gray",
        }}
      >
        Got <Span>{lines}</Span> lines of output
      </Span>
      {imageParts.map((part, i) => (
        <ImageContentRenderer key={i} image={part.image} />
      ))}
    </TerminalFlex>
  );
}
function ContentRenderer({
  content,
  textColor,
}: {
  content: Content["content"];
  textColor?: string;
}) {
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
      }}
    >
      {content.map((part, i) => {
        if (part.type === "image") {
          return <ImageContentRenderer key={i} image={part.image} />;
        }
        return part.content.split(LINE_SPLIT_REGEX).map((line, lineIndex) => (
          <Span
            key={`${i}-${lineIndex}`}
            style={{
              color: textColor,
            }}
          >
            {line}
          </Span>
        ));
      })}
    </TerminalFlex>
  );
}
function ImageContentRenderer({ image }: { image: ImageInfo }) {
  return (
    <Span
      style={{
        color: "#111827",
        backgroundColor: "#e5e7eb",
      }}
    >
      ⟦ 📎 {image.filePath} ({Math.ceil(image.sizeBytes / 1024)} KB) ⟧
    </Span>
  );
}
function WhitelistAllowDescription({ toolCallRequest }: { toolCallRequest: ToolCallRequest }) {
  const fn = parsedToolSchema(toolCallRequest);
  const cwd = useCwd();
  switch (fn.name) {
    case "glob":
      return <Span> local glob searches in this session.</Span>;
    case "grep":
      return <Span> local grep searches in this session.</Span>;
    case "shell": {
      return (
        <Span>
          <Span> commands starting with </Span>
          <Span
            style={{
              fontWeight: "bold",
            }}
          >
            {fn.arguments.cmd}
          </Span>
        </Span>
      );
    }
    case "fetch": {
      return <Span> fetches from the web during this session.</Span>;
    }
    case "web-search": {
      return <Span> Web Searches during this session.</Span>;
    }
    case "list":
    case "read":
    case "partial-read": {
      return (
        <Span>
          <Span> file reads in </Span>
          <Span
            style={{
              fontWeight: "bold",
            }}
          >
            {cwd}
          </Span>
        </Span>
      );
    }
    case "edit":
    case "create":
    case "rewrite": {
      return (
        <Span>
          <Span> file changes in </Span>
          <Span
            style={{
              fontWeight: "bold",
            }}
          >
            {cwd}
          </Span>
        </Span>
      );
    }
    case "mcp": {
      return (
        <Span>
          {" "}
          MCP tools with Server:{" "}
          <Span
            style={{
              fontWeight: "bold",
            }}
          >
            {fn.arguments.server}
          </Span>{" "}
          using Tool:{" "}
          <Span
            style={{
              fontWeight: "bold",
            }}
          >
            {fn.arguments.tool}
          </Span>
        </Span>
      );
    }
    case "skill": {
      return <Span> {fn.arguments.skillName} skill executions</Span>;
    }
    case "lsp-definition":
    case "lsp-references":
    case "lsp-hover":
    case "lsp-diagnostics":
    case "lsp-document-symbol":
    case "lsp-implementation":
    case "lsp-incoming-calls":
    case "lsp-outgoing-calls":
      return <Span> LSP queries during this session.</Span>;
  }
  return <Span> this tool in this session.</Span>;
}
const OCTO_MARGIN = 1;
const OCTO_PADDING = 2;
function OctoMessageRenderer({ children }: { children?: React.ReactNode }) {
  return (
    <TerminalFlex>
      <TerminalFlex
        style={{
          marginRight: OCTO_MARGIN,
          width: OCTO_PADDING,
          flexShrink: 0,
          flexGrow: 0,
        }}
      >
        <Octo />
      </TerminalFlex>
      {children}
    </TerminalFlex>
  );
}
function CompactionRenderer({ item }: { item: AssistantDisplayItem }) {
  return (
    <OctoMessageRenderer>
      <TerminalFlex
        style={{
          flexDirection: "column",
          flexGrow: 1,
          minWidth: 0,
        }}
      >
        <Span
          style={{
            color: "gray",
          }}
        >
          {item.content}
        </Span>
      </TerminalFlex>
    </OctoMessageRenderer>
  );
}
function AssistantMessageRenderer({ item }: { item: AssistantDisplayItem }) {
  const thoughts = item.reasoningContent ? item.reasoningContent.trim() : item.reasoningContent;
  const content = item.content.trim();
  const showThoughts = thoughts && thoughts !== "";
  return (
    <OctoMessageRenderer>
      <TerminalFlex
        style={{
          flexDirection: "column",
          flexGrow: 1,
          minWidth: 0,
        }}
      >
        {showThoughts && <ThoughtBox thoughts={thoughts} />}
        <Markdown markdown={content} />
      </TerminalFlex>
    </OctoMessageRenderer>
  );
}
const MAX_THOUGHTBOX_HEIGHT = 8;
const MAX_THOUGHTBOX_WIDTH = 80;

function scrollToBottom(element: DivElement | null): void {
  if (!element) return;
  element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
}

function isScrolledToBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): boolean {
  return scrollTop >= Math.max(0, scrollHeight - clientHeight);
}

function ThoughtBox({ thoughts }: { thoughts: string }) {
  const viewportRef = useRef<DivElement>(null);
  const followThoughtsRef = useRef(true);

  useEffect(() => {
    if (followThoughtsRef.current) scrollToBottom(viewportRef.current);
  }, [thoughts]);

  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
      }}
    >
      <TerminalFlex
        ref={viewportRef}
        onScroll={event => {
          followThoughtsRef.current = isScrolledToBottom(
            event.scrollTop,
            event.scrollHeight,
            viewportRef.current?.clientHeight ?? 1,
          );
        }}
        style={{
          flexGrow: 0,
          flexShrink: 1,
          minWidth: 0,
          maxWidth: MAX_THOUGHTBOX_WIDTH,
          maxHeight: MAX_THOUGHTBOX_HEIGHT,
          overflowY: "scroll",
          scrollbarGutter: "auto",
          scrollbarColor: SUBTLE_SCROLLBAR_COLOR,
          flexDirection: "column",
          borderColor: THOUGHTBOX_COLOR,
          border: "rounded",
        }}
      >
        <TerminalFlex
          style={{
            flexGrow: 0,
            flexShrink: 0,
            flexDirection: "column",
          }}
        >
          <Span
            style={{
              color: THOUGHTBOX_COLOR,
            }}
          >
            {thoughts}
          </Span>
        </TerminalFlex>
      </TerminalFlex>
    </TerminalFlex>
  );
}
