import React, { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef } from "react";
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
import RetryCountdown from "./components/retry-countdown.tsx";
import { Header } from "./header.tsx";
import {
  DIMMED_SCROLLBAR_COLOR,
  MARKDOWN_INLINE_CODE_BACKGROUND_COLOR,
  MARKDOWN_INLINE_CODE_FOREGROUND_COLOR,
  SCROLLBAR_COLOR,
  SUBTLE_SCROLLBAR_COLOR,
  THOUGHTBOX_COLOR,
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
import { ALWAYS_REQUEST_PERMISSION_TOOLS } from "./tools/index.ts";
import { ParsedSchema as EditParsedSchema } from "./tools/tool-defs/edit.ts";
import { useShallow } from "zustand/react/shallow";
import { KbShortcutPanel } from "./components/kb-select/kb-shortcut-panel.tsx";
import { Item, ShortcutArray } from "./components/kb-select/kb-shortcut-select.tsx";
import {
  useAppStore,
  useModel,
  InflightResponseType,
  LiveMirror,
  PermissionUiState,
  inputFieldAvailable,
  userMessageContent,
  MAX_RETRY_COUNT,
} from "./state.ts";
import type {
  TrajectoryMode,
  RetryControl,
  RectifyControl,
  ClearControl,
} from "./libocto/trajectory.ts";
import type { octoAgent } from "./ir/octo-ir.ts";
import type { UserMessage } from "./libocto/llm-ir.ts";
import type { HistoryNode } from "./session-history/index.ts";
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
import { SessionContext } from "./session-context.ts";
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
import { type OctoPermissionControl } from "./octo-permissions.ts";
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
import { InputDisabledProvider } from "./hooks/use-input-disabled.tsx";
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
  setTempNotification,
}: {
  setTempNotification: (notif: string | null) => void;
}) {
  const unchained = useAppStore(state => state.unchained);
  const setUnchained = useAppStore(state => state.setUnchained);
  usePriorityInput(UNCHAINED_PRIORITY, event => {
    if (event.shiftKey && event.key === "Tab") {
      event.preventDefault();
      setUnchained(!unchained);
      setTempNotification(unchained ? CHAINED_NOTIF : UNCHAINED_NOTIF);
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
  const [tempNotification, setTempNotification] = useState<string | null>(
    unchained ? UNCHAINED_NOTIF : CHAINED_NOTIF,
  );
  const {
    history,
    sessionMode,
    inflightResponse,
    isMenuOpen,
    clearNonce,
    sessionHydrationNonce,
    modelOverride,
    cancelNotifyReadyForInput,
    closeMenu,
    query,
    setUnchained,
  } = useAppStore(
    useShallow(state => ({
      history: state.history,
      sessionMode: state.sessionMode,
      inflightResponse: state.inflightResponse,
      isMenuOpen: state.isMenuOpen,
      clearNonce: state.clearNonce,
      sessionHydrationNonce: state.sessionHydrationNonce,
      modelOverride: state.modelOverride,
      cancelNotifyReadyForInput: state.cancelNotifyReadyForInput,
      closeMenu: state.closeMenu,
      query: state.query,
      setUnchained: state.setUnchained,
    })),
  );
  const updateConfig = sessionMode.mode === "live" ? sessionMode.control.updateConfig : null;
  useEffect(() => {
    updateConfig?.(currConfig);
  }, [updateConfig, currConfig]);
  useLayoutEffect(() => {
    setUnchained(unchained);
  }, [setUnchained, unchained]);
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
  const historyItems: TranscriptItem[] = useMemo(
    () => history.map(item => ({ type: "history-item", item })),
    [history],
  );
  const liveMirror = sessionMode.mode === "live" ? sessionMode.liveMode : null;
  const trajectoryMode = liveMirror?.trajectoryMode ?? null;
  useLayoutEffect(() => {
    scrollTranscriptToBottom();
  }, [
    clearNonce,
    history.length,
    inflightResponse?.content,
    inflightResponse?.reasoningContent,
    trajectoryMode?.mode,
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
  if (sessionMode.mode === "booting") return null;
  return (
    <ScrollTranscriptToBottomContext.Provider value={scrollTranscriptToBottomIfNeeded}>
      <ReactDevelopmentBuildToast />
      <SetConfigContext.Provider value={setCurrConfig}>
        <ConfigPathContext.Provider value={configPath}>
          <ConfigContext.Provider value={currConfig}>
            <TransportContext.Provider value={transport}>
              <CwdContext.Provider value={cwd}>
                <InputDisabledProvider disabled={isMenuOpen}>
                  <ExitOnDoubleCtrlC>
                    <InputPriorityProvider>
                      <UnchainedShiftTabHandler setTempNotification={setTempNotification} />
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
                              {historyItems.map((item, index) => (
                                <TranscriptItemRenderer item={item} key={`history-${index}`} />
                              ))}
                              {(trajectoryMode?.mode === "responding" ||
                                trajectoryMode?.mode === "compacting") &&
                                inflightResponse != null &&
                                (inflightResponse.reasoningContent || inflightResponse.content) && (
                                  <MessageDisplay item={inflightResponse} />
                                )}
                              {liveMirror != null &&
                                isToolTrajectoryMode(liveMirror.trajectoryMode) && (
                                  <ToolRequestsRenderer
                                    trajectoryMode={liveMirror.trajectoryMode}
                                    permissionUi={liveMirror.permissionUi}
                                    onContentLayout={scrollTranscriptToBottom}
                                  />
                                )}
                            </TerminalFlex>
                          </TerminalFlex>
                        </TerminalFlex>
                        {sessionMode.mode === "lost" ? (
                          <SessionLostScreen
                            sessionId={sessionMode.sessionId}
                            error={sessionMode.sessionLostError}
                          />
                        ) : (
                          <BottomBar
                            inputHistory={inputHistory}
                            metadata={metadata}
                            tempNotification={tempNotification}
                            liveMode={sessionMode.liveMode}
                            updateConfig={sessionMode.control.updateConfig}
                          />
                        )}
                      </AppShell>
                    </InputPriorityProvider>
                  </ExitOnDoubleCtrlC>
                </InputDisabledProvider>
                {sessionMode.mode === "live" && isMenuOpen && (
                  <Modal minWidth={50} onClose={closeMenu}>
                    <SessionContext.Provider value={sessionMode.session}>
                      <Menu />
                    </SessionContext.Provider>
                  </Modal>
                )}
              </CwdContext.Provider>
            </TransportContext.Provider>
          </ConfigContext.Provider>
        </ConfigPathContext.Provider>
      </SetConfigContext.Provider>
    </ScrollTranscriptToBottomContext.Provider>
  );
}

function SessionLostScreen({ sessionId, error }: { sessionId: string | null; error: string }) {
  const { exit } = useApp();
  useKeyboard(() => {
    exit();
  });
  return (
    <CenteredBox>
      <Span style={{ color: "red" }}>
        Session{sessionId ? ` ${sessionId} ` : " "}lost — was it deleted?
      </Span>
      <Span>{error}</Span>
      <Span style={{ color: "gray" }}>Press any key to quit Octo.</Span>
    </CenteredBox>
  );
}
function BottomBar({
  inputHistory,
  metadata,
  tempNotification,
  liveMode,
  updateConfig,
}: {
  inputHistory: InputHistory;
  metadata: Metadata;
  tempNotification: string | null;
  liveMode: LiveMirror;
  updateConfig: (config: Config) => void;
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
      <BottomBarContent
        inputHistory={inputHistory}
        liveMode={liveMode}
        updateConfig={updateConfig}
      />
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
function QueuedSteeringPreview({ queued }: { queued: readonly UserMessage["content"][] }) {
  if (queued.length === 0) return null;
  const preview = excerpt(
    queued
      .map(content => {
        const textPart = content.find(part => part.type === "text");
        return textPart?.type === "text" ? textPart.content.split("\n")[0] : "";
      })
      .join(" · "),
  );
  return (
    <Span
      style={{
        color: "gray",
      }}
    >
      Queued ({queued.length}): {preview}
    </Span>
  );
}

function useInputMode({
  vimEnabled,
  trajectoryMode,
  permissionUi,
  clearNonce,
}: {
  vimEnabled: boolean;
  trajectoryMode: TrajectoryMode<typeof octoAgent>;
  permissionUi: PermissionUiState;
  clearNonce: number;
}) {
  const inputAvailable = inputFieldAvailable(trajectoryMode, permissionUi);
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

function BottomBarContent({
  inputHistory,
  liveMode,
  updateConfig,
}: {
  inputHistory: InputHistory;
  liveMode: LiveMirror;
  updateConfig: (config: Config) => void;
}) {
  const config = useConfig();
  const model = useModel();
  const { trajectoryMode, permissionUi } = liveMode;
  const {
    clearNonce,
    openMenu,
    byteCount,
    query,
    setQuery,
    attachedImages,
    addAttachedImage,
    removeLastAttachedImage,
    clearAttachedImages,
    queuedSteering,
  } = useAppStore(
    useShallow(state => ({
      clearNonce: state.clearNonce,
      openMenu: state.openMenu,
      byteCount: state.byteCount,
      query: state.query,
      setQuery: state.setQuery,
      attachedImages: state.attachedImages,
      addAttachedImage: state.addAttachedImage,
      removeLastAttachedImage: state.removeLastAttachedImage,
      clearAttachedImages: state.clearAttachedImages,
      queuedSteering: state.queuedSteering,
    })),
  );

  const { inputMode, setVimMode, inputSubmitted } = useInputMode({
    vimEnabled: !!config.vimEmulation?.enabled,
    trajectoryMode,
    permissionUi,
    clearNonce,
  });

  useCtrlC(() => {
    if (inputMode.kind === "vim") return;
    setQuery("");
  });
  useKeyboard(event => {
    if (event.key === "Escape") {
      if (event.defaultPrevented) return;
      // Vim INSERT mode: Esc ONLY returns to NORMAL (no menu, no abort)
      if (inputMode.kind === "vim" && inputMode.mode === "INSERT") {
        setVimMode("NORMAL");
        return;
      }
      // Never interrupt at a permission prompt: ESC only navigates the prompt itself;
      // abandoning the turn out from under an awaiting decision would strand the batch.
      if (
        trajectoryMode.mode === "responding" ||
        trajectoryMode.mode === "compacting" ||
        trajectoryMode.mode === "autofix-json" ||
        trajectoryMode.mode === "autofix-tool" ||
        trajectoryMode.mode === "request-error-retrying" ||
        trajectoryMode.mode === "tool-call" ||
        trajectoryMode.mode === "running-tool"
      ) {
        void trajectoryMode.control.interrupt();
      } else {
        const _:
          | "ready-for-request"
          | "tool-call-permission"
          | "request-error"
          | "compaction-error"
          | "payment-error"
          | "rate-limit-error"
          | "auth-error"
          | "aborted" = trajectoryMode.mode;
      }
    }
    if (event.ctrlKey && event.key === "p") {
      openMenu();
    }
  });
  const color = useColor();
  const onSubmit = useCallback(
    (submittedQuery?: string, images?: ImageInfo[]) => {
      const finalQuery = submittedQuery ?? query;
      inputSubmitted();
      setQuery("");
      if (permissionUi.type === "awaiting-steering") {
        permissionUi.rejectionTx.commitRejection(userMessageContent(finalQuery, images));
        return;
      }
      if (
        trajectoryMode.mode === "ready-for-request" ||
        trajectoryMode.mode === "responding" ||
        trajectoryMode.mode === "compacting" ||
        trajectoryMode.mode === "autofix-json" ||
        trajectoryMode.mode === "autofix-tool" ||
        trajectoryMode.mode === "request-error-retrying" ||
        trajectoryMode.mode === "tool-call" ||
        trajectoryMode.mode === "running-tool"
      ) {
        void trajectoryMode.control.enqueueSteering(userMessageContent(finalQuery, images));
      } else {
        const _:
          | "tool-call-permission"
          | "request-error"
          | "compaction-error"
          | "payment-error"
          | "rate-limit-error"
          | "auth-error"
          | "aborted" = trajectoryMode.mode;
      }
    },
    [query, permissionUi, trajectoryMode, setQuery, inputSubmitted],
  );
  if (
    trajectoryMode.mode === "responding" ||
    trajectoryMode.mode === "compacting" ||
    trajectoryMode.mode === "autofix-json" ||
    trajectoryMode.mode === "autofix-tool" ||
    trajectoryMode.mode === "request-error-retrying" ||
    trajectoryMode.mode === "tool-call" ||
    trajectoryMode.mode === "running-tool"
  ) {
    const overrideStrings = (() => {
      if (trajectoryMode.mode === "compacting") {
        return ["Compacting history to save context tokens"];
      }
      if (trajectoryMode.mode === "autofix-tool") return ["Auto-fixing diff"];
      if (trajectoryMode.mode === "autofix-json") return ["Auto-fixing JSON"];
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
          {trajectoryMode.mode === "request-error-retrying" ? (
            <RetryCountdown
              key={trajectoryMode.attempt}
              error={trajectoryMode.error}
              attempt={trajectoryMode.attempt}
              max={MAX_RETRY_COUNT}
              delayMs={trajectoryMode.delayMs}
            />
          ) : (
            <Loading overrideStrings={overrideStrings} />
          )}
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
        <QueuedSteeringPreview queued={queuedSteering} />
        <MultimediaInput
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
  if (trajectoryMode.mode === "payment-error") {
    return (
      <PaymentErrorScreen error={trajectoryMode.requestError} control={trajectoryMode.control} />
    );
  }
  if (trajectoryMode.mode === "rate-limit-error") {
    return (
      <RateLimitErrorScreen error={trajectoryMode.requestError} control={trajectoryMode.control} />
    );
  }
  if (trajectoryMode.mode === "auth-error") {
    return (
      <AuthErrorScreen
        model={model}
        error={{ type: "invalid", message: trajectoryMode.authError }}
        config={config}
        control={trajectoryMode.control}
        updateConfig={updateConfig}
      />
    );
  }
  if (trajectoryMode.mode === "request-error" || trajectoryMode.mode === "compaction-error") {
    return (
      <RequestErrorScreen
        contextualMessage={
          trajectoryMode.mode === "request-error"
            ? "It looks like you've hit a request error!"
            : "History compaction failed due to a request error!"
        }
        error={trajectoryMode.requestError}
        curlCommand={trajectoryMode.curl}
        control={trajectoryMode.control}
      />
    );
  }
  if (trajectoryMode.mode === "tool-call-permission" && permissionUi.type !== "awaiting-steering") {
    return null;
  }
  const _: "ready-for-request" | "tool-call-permission" | "aborted" = trajectoryMode.mode;
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
      <QueuedSteeringPreview queued={queuedSteering} />
      <MultimediaInput
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
  control,
  updateConfig,
}: {
  model: Config["models"][number];
  error: AuthError;
  config: Config;
  control: RetryControl & ClearControl;
  updateConfig: (config: Config) => void;
}) {
  const setConfig = useSetConfig();
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
      updateConfig(updatedConfig);
      control.retry();
    },
    [config, model, resolveModelIndex, setConfig, updateConfig, control],
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
        onCancel={() => control.clear()}
      />
    </TerminalFlex>
  );
}
function RequestErrorScreen({
  contextualMessage,
  error,
  curlCommand,
  control,
}: {
  contextualMessage: string;
  error: string;
  curlCommand: string | null;
  control: RectifyControl;
}) {
  const themeColor = useColor();
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
        control.retry();
      } else if (item.value === "edit-retry") {
        void control.rewind();
      } else {
        const _: "quit" = item.value;
        exit();
      }
    },
    [curlCommand, control, exit],
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
function RateLimitErrorScreen({ error, control }: { error: string; control: RetryControl }) {
  useKeyboard(() => {
    control.retry();
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
function PaymentErrorScreen({ error, control }: { error: string; control: RetryControl }) {
  useKeyboard(() => {
    control.retry();
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
type ToolTrajectoryMode = Extract<
  TrajectoryMode<typeof octoAgent>,
  { mode: "tool-call" | "running-tool" | "tool-call-permission" }
>;

function isToolTrajectoryMode(mode: TrajectoryMode<typeof octoAgent>): mode is ToolTrajectoryMode {
  return (
    mode.mode === "tool-call" ||
    mode.mode === "running-tool" ||
    mode.mode === "tool-call-permission"
  );
}

function ToolRequestsRenderer({
  trajectoryMode,
  permissionUi,
  onContentLayout,
}: {
  trajectoryMode: ToolTrajectoryMode;
  permissionUi: PermissionUiState;
  onContentLayout: () => void;
}) {
  // Display-only: the trajectory drives the batch and knows exactly what's current. The
  // transient "tool-call" mode precedes the first gated/running call.
  const currentToolReq =
    trajectoryMode.mode === "tool-call" ? trajectoryMode.toolCalls[0] : trajectoryMode.toolCall;
  const actionKey = `${trajectoryMode.mode}:${currentToolReq.toolCallId}`;
  useLayoutEffect(() => {
    onContentLayout();
  }, [actionKey, onContentLayout]);
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
      }}
    >
      <ToolMessageRenderer item={currentToolReq} />
      {permissionUi.type === "prompt" && (
        <ToolPermissionSelect control={permissionUi.control} onContentLayout={onContentLayout} />
      )}
    </TerminalFlex>
  );
}
function ToolPermissionSelect({
  control,
  onContentLayout,
}: {
  control: OctoPermissionControl;
  onContentLayout: () => void;
}) {
  const themeColor = useColor();
  const scrollTranscriptToBottomIfNeeded = useScrollTranscriptToBottom();
  const toolReq = control.toolCall;
  const toolName = toolReq.name;
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
    ...(!ALWAYS_REQUEST_PERMISSION_TOOLS.includes(toolName)
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
    (item: (typeof items)[number]) => {
      if (item.value === "no") {
        control.beginReject();
      } else if (item.value === "yes-whitelist") {
        control.allowAndWhitelist();
      } else {
        control.allow();
      }
    },
    [control],
  );
  useLayoutEffect(() => {
    onContentLayout();
  }, [onContentLayout]);
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
  const isCompacting = useAppStore(
    state =>
      state.sessionMode.mode === "live" &&
      state.sessionMode.liveMode.trajectoryMode.mode === "compacting",
  );
  if (item.type === "inflight-response") {
    return renderInflightResponse(item, isCompacting);
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
    return renderLlmIR(item.ir, isCompacting);
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
            <TerminalFlex key={i} style={{ minHeight: 1 }}>
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
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
      }}
    >
      <ToolCallRow name={item.name}>Octo is starting a background process:</ToolCallRow>
      <Span>
        <Span
          style={{
            color: "gray",
          }}
        >
          Label:
        </Span>{" "}
        <Span
          style={{
            fontWeight: "bold",
          }}
        >
          {item.arguments.label}
        </Span>
      </Span>
      <Span>
        <Span
          style={{
            color: "gray",
          }}
        >
          Command:
        </Span>{" "}
        <Span
          style={{
            color: MARKDOWN_INLINE_CODE_FOREGROUND_COLOR,
            backgroundColor: MARKDOWN_INLINE_CODE_BACKGROUND_COLOR,
          }}
        >
          {item.arguments.cmd}
        </Span>
      </Span>
    </TerminalFlex>
  );
}

function ManageBackgroundProcessToolRenderer({
  item,
}: {
  item: ParsedToolSchemaFrom<typeof manageBackgroundProcess>;
}) {
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
      }}
    >
      <ToolCallRow name={item.name}>Octo is managing a background process:</ToolCallRow>
      <Span>
        <Span style={{ color: "gray" }}>Action:</Span>{" "}
        <Span style={{ fontWeight: "bold" }}>{item.arguments.action}</Span>
      </Span>
      {item.arguments.label != null && (
        <Span>
          <Span style={{ color: "gray" }}>Label:</Span>{" "}
          <Span style={{ fontWeight: "bold" }}>{item.arguments.label}</Span>
        </Span>
      )}
      {item.arguments.id != null && (
        <Span>
          <Span style={{ color: "gray" }}>ID:</Span>{" "}
          <Span
            style={{
              color: MARKDOWN_INLINE_CODE_FOREGROUND_COLOR,
              backgroundColor: MARKDOWN_INLINE_CODE_BACKGROUND_COLOR,
            }}
          >
            {item.arguments.id}
          </Span>
        </Span>
      )}
      {item.arguments.timeout != null && (
        <Span>
          <Span style={{ color: "gray" }}>Timeout:</Span> {item.arguments.timeout}ms
        </Span>
      )}
    </TerminalFlex>
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
