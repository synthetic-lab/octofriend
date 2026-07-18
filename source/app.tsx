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
  mergeEnvVar,
  readAuthForModel,
  useConfig,
  useSetConfig,
} from "./config.ts";
import Loading from "./components/loading.tsx";
import { Header } from "./header.tsx";
import {
  SCROLLBAR_COLOR,
  SUBTLE_SCROLLBAR_COLOR,
  UnchainedContext,
  useColor,
  useUnchained,
} from "./theme.ts";
import { DiffRenderer } from "./components/diff-renderer.tsx";
import { FileRenderer } from "./components/file-renderer.tsx";
import shell from "./tools/tool-defs/bash.ts";
import read from "./tools/tool-defs/read.ts";
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
import { ALWAYS_REQUEST_PERMISSION_TOOLS, SKIP_CONFIRMATION_TOOLS } from "./tools/index.ts";
import { ParsedSchema as EditParsedSchema } from "./tools/tool-defs/edit.ts";
import { useShallow } from "zustand/react/shallow";
import { KbShortcutPanel } from "./components/kb-select/kb-shortcut-panel.tsx";
import { Item, ShortcutArray } from "./components/kb-select/kb-shortcut-select.tsx";
import { useAppStore, RunArgs, useModel, InflightResponseType } from "./state.ts";
import type { Session } from "./session-history/index.ts";
import { Octo } from "./components/octo.tsx";
import { Menu } from "./menu.tsx";
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
import { LINE_SPLIT_REGEX } from "./str.ts";
import { countLines } from "./str.ts";
import { VimModeIndicator } from "./components/vim-mode.tsx";
import type { ToolCall } from "./libocto/tool-def.ts";
import type toolMap from "./tools/tool-defs/index.ts";
import type { Content, MalformedToolRequest } from "./libocto/llm-ir.ts";
import type { OctoIR } from "./ir/octo-ir.ts";
import {
  InputPriorityProvider,
  usePriorityInput,
  UNCHAINED_PRIORITY,
} from "./hooks/use-priority-input.tsx";
import { readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { CwdContext, useCwd } from "./hooks/use-cwd.tsx";
import { LspToolRenderer } from "./components/lsp-tool-renderer.tsx";
import { CustomAuthFlow } from "./components/add-model-flow.tsx";
import { HistoryNode } from "./session-history/index.ts";
import { Span, useAnimation, useApp } from "paintcannon-react";
import { useKeyboard } from "./hooks/use-keyboard.ts";
import { TerminalFlex } from "./components/terminal-flex.tsx";
import { ScrollTranscriptToBottomContext } from "./transcript-scroll.ts";
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
  const transcriptRef = useRef<DivElement>(null);
  const followTranscriptRef = useRef(true);
  const keyboardScrollActiveRef = useRef(false);
  const keyboardScrollStartRef = useRef(0);
  const [isKeyboardScrollActive, setIsKeyboardScrollActive] = useState(false);
  const { time: keyboardScrollTime } = useAnimation({
    isActive: isKeyboardScrollActive,
  });
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
  const { history, modeData, setVimMode, clearNonce, cancelNotifyReadyForInput } = useAppStore(
    useShallow(state => ({
      history: state.history,
      modeData: state.modeData,
      setVimMode: state.setVimMode,
      clearNonce: state.clearNonce,
      cancelNotifyReadyForInput: state.cancelNotifyReadyForInput,
    })),
  );
  useKeyboard(event => {
    cancelNotifyReadyForInput();
  });
  useEffect(() => {
    if (updates != null) markUpdatesSeen();
    if (currConfig.vimEmulation?.enabled) setVimMode("INSERT");
  }, []);
  const skillNotifs: string[] = [];
  if (bootSkills.length > 0) {
    skillNotifs.push(" ");
    skillNotifs.push("Configured skills:");
    skillNotifs.push(...bootSkills.map(s => `- ${s}`));
  }
  const bootItems: TranscriptItem[] = useMemo(() => {
    let items = [
      {
        type: "header" as const,
      },
      {
        type: "version" as const,
        metadata,
        config: currConfig,
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
  }, [currConfig, skillNotifs, updates]);
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
  return (
    <ScrollTranscriptToBottomContext.Provider value={scrollTranscriptToBottomIfNeeded}>
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
                        <TerminalFlex
                          onKeyDown={event => {
                            if (event.key === "Enter" && scrollTranscriptToBottomIfNeeded()) {
                              event.preventDefault();
                              event.stopPropagation();
                            }
                          }}
                          style={{
                            flexDirection: "column",
                            width: "100%",
                            height: "100%",
                          }}
                        >
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
                              scrollbarColor: SCROLLBAR_COLOR,
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
                                {modeData.mode === "tool-call" && (
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
                            onSessionChange={handleSessionChange}
                          />
                        </TerminalFlex>
                      </ExitOnDoubleCtrlC>
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
  onSessionChange,
}: {
  inputHistory: InputHistory;
  metadata: Metadata;
  tempNotification: string | null;
  onSessionChange: (session: Session) => void;
}) {
  const TEMP_NOTIFICATION_DURATION = 5000;
  const [versionCheck, setVersionCheck] = useState("Checking for updates...");
  const [displayedTempNotification, setDisplayedTempNotification] =
    useState<React.ReactNode | null>(null);
  const themeColor = useColor();
  const ctrlCPressed = useCtrlCPressed();
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
  if (modeData.mode === "menu") return <Menu onSessionChange={onSessionChange} />;
  const unchained = useUnchained();
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
        width: "100%",
      }}
    >
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
        <TerminalFlex
          style={{
            height: 1,
          }}
        >
          <Span
            style={{
              color: themeColor,
            }}
          >
            {ctrlCPressed && "Press Ctrl+C again to exit."}
          </Span>
          {!ctrlCPressed && (
            <Span
              style={{
                color: "gray",
              }}
            >
              {unchained ? "⚡ Unchained mode" : "Collaboration mode"}{" "}
              <Span
                style={{
                  color: "gray",
                }}
              >
                (Shift+Tab to toggle)
              </Span>
            </Span>
          )}
        </TerminalFlex>
        <Span
          style={{
            color: themeColor,
          }}
        >
          {versionCheck}
        </Span>
      </TerminalFlex>
      <TerminalFlex
        style={{
          minHeight: 1,
        }}
      >
        {displayedTempNotification && (
          <TerminalFlex
            style={{
              width: "100%",
              flexShrink: 0,
            }}
          >
            <Span
              style={{
                color: themeColor,
                whiteSpace: "pre-wrap",
              }}
            >
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
function BottomBarContent({ inputHistory }: { inputHistory: InputHistory }) {
  const config = useConfig();
  const model = useModel();
  const transport = useContext(TransportContext);
  const session = useSession();
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
  useKeyboard(event => {
    if (event.key === "Escape") {
      // Vim INSERT mode: Esc ONLY returns to NORMAL (no menu, no abort)
      if (vimEnabled && vimMode === "INSERT" && modeData.mode === "input") {
        setVimMode("NORMAL");
        return;
      }
      abortResponse();
      if (modeData.mode === "menu") closeMenu();
    }
    if (event.ctrlKey && event.key === "p") {
      openMenu();
    }
  });
  const color = useColor();
  const onSubmit = useCallback(
    async (submittedQuery?: string, images?: ImageInfo[]) => {
      const finalQuery = submittedQuery ?? query;
      setQuery("");
      await input({
        query: finalQuery,
        config,
        transport,
        session,
        images,
      });
    },
    [query, config, transport, session, setQuery],
  );
  if (modeData.mode === "responding" || modeData.mode === "compacting") {
    return (
      <TerminalFlex
        style={{
          justifyContent: "space-between",
        }}
      >
        <Loading
          overrideStrings={
            modeData.mode === "compacting"
              ? ["Compacting history to save context tokens"]
              : undefined
          }
        />
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
  if (modeData.mode === "tool-call") {
    return null;
  }
  const _: "menu" | "input" = modeData.mode;
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
      }}
    >
      <TerminalFlex
        style={{
          marginLeft: 1,
          justifyContent: "flex-end",
        }}
      >
        <Span
          style={{
            color: "gray",
          }}
        >
          (Ctrl+p to enter the menu)
        </Span>
      </TerminalFlex>
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
  useKeyboard(event => {
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
  useKeyboard(event => {
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
  const [currentIndex, setCurrentIndex] = useState(0);
  const onDone = useCallback(() => {
    setCurrentIndex(i => i + 1);
  }, []);
  useLayoutEffect(() => {
    onContentLayout();
  }, [currentIndex, onContentLayout]);
  if (currentIndex >= toolReqs.length) {
    return (
      <FinishToolRequests
        runAgent={runAgent}
        config={config}
        transport={transport}
        session={session}
      />
    );
  }
  const currentToolReq = toolReqs[currentIndex];
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
        onDone={onDone}
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
  onDone,
  onContentLayout,
}: {
  toolReq: ToolCallRequest;
  onDone: () => void;
  onContentLayout: () => void;
} & RunArgs) {
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
    const fn = parsedToolSchema(toolReq);
    switch (fn.name) {
      case "read":
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
  const [isToolWhitelisted, setIsToolWhitelisted] = useState<boolean | null>(null);
  useEffect(() => {
    (async () => {
      const whitelisted = await isWhitelisted(whitelistKey);
      setIsToolWhitelisted(whitelisted);
    })();
  }, [whitelistKey, isWhitelisted]);
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
        rejectTool(toolReq, session);
      } else if (item.value === "yes-whitelist") {
        await addToWhitelist(whitelistKey);
        await runTool({
          toolReq,
          config,
          transport,
          session,
        });
        onDone();
      } else {
        await runTool({
          toolReq,
          config,
          transport,
          session,
        });
        onDone();
      }
    },
    [
      toolReq,
      config,
      transport,
      session,
      addToWhitelist,
      runTool,
      rejectTool,
      whitelistKey,
      onDone,
    ],
  );
  const { modeData } = useAppStore(
    useShallow(state => ({
      modeData: state.modeData,
    })),
  );
  const isRunning =
    modeData.mode === "tool-call" && modeData.runningToolCallId === toolReq.toolCallId;
  const noConfirmationNeeded =
    unchained || SKIP_CONFIRMATION_TOOLS.includes(toolReq.name) || isToolWhitelisted === true;
  useLayoutEffect(() => {
    onContentLayout();
  }, [isRunning, noConfirmationNeeded, onContentLayout]);
  useEffect(() => {
    if (noConfirmationNeeded) {
      runTool({
        toolReq,
        config,
        transport,
        session,
      }).then(onDone);
    } else {
      notifyReadyForInput(config);
    }
  }, [toolReq, noConfirmationNeeded, config, transport, session, onDone]);
  if (noConfirmationNeeded || isRunning) {
    return (
      <Loading
        overrideStrings={["Waiting", "Watching", "Smiling", "Hungering", "Splashing", "Writhing"]}
      />
    );
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
        indicatorComponent={IndicatorComponent}
        itemComponent={ToolRequestItem}
      />
    </TerminalFlex>
  );
}
const TranscriptItemRenderer = ({ item }: { item: TranscriptItem }) => {
  const themeColor = useColor();
  const model = useModel();
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
          Model: {model.nickname}
        </Span>
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
};
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
    case "list":
      return <ListToolRenderer item={parsedToolSchema(item)} />;
    case "shell":
      return <ShellToolRenderer item={parsedToolSchema(item)} />;
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
  const themeColor = useColor();
  return (
    <TerminalFlex>
      <Span
        style={{
          color: "gray",
        }}
      >
        {item.name}:{" "}
      </Span>
      <Span
        style={{
          color: themeColor,
        }}
      >
        {item.arguments.url}
      </Span>
    </TerminalFlex>
  );
}
function ShellToolRenderer({ item }: { item: ParsedToolSchemaFrom<typeof shell> }) {
  const themeColor = useColor();
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
      }}
    >
      <TerminalFlex>
        <Span
          style={{
            color: "gray",
          }}
        >
          {item.name}:{" "}
        </Span>
        <Span
          style={{
            color: themeColor,
          }}
        >
          {item.arguments.cmd}
        </Span>
      </TerminalFlex>
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
function ReadToolRenderer({ item }: { item: ParsedToolSchemaFrom<typeof read> }) {
  const themeColor = useColor();
  return (
    <TerminalFlex>
      <Span
        style={{
          color: "gray",
        }}
      >
        {item.name}:{" "}
      </Span>
      <Span
        style={{
          color: themeColor,
        }}
      >
        {item.arguments.filePath}
      </Span>
    </TerminalFlex>
  );
}
function ListToolRenderer({ item }: { item: ParsedToolSchemaFrom<typeof list> }) {
  const themeColor = useColor();
  return (
    <TerminalFlex>
      <Span
        style={{
          color: "gray",
        }}
      >
        {item.name}:{" "}
      </Span>
      <Span
        style={{
          color: themeColor,
        }}
      >
        {item?.arguments?.dirPath || process.cwd()}
      </Span>
    </TerminalFlex>
  );
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
  const themeColor = useColor();
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
      }}
    >
      <TerminalFlex>
        <Span
          style={{
            color: "gray",
          }}
        >
          {item.name}:{" "}
        </Span>
        <Span
          style={{
            color: themeColor,
          }}
        >
          Server: {item.arguments.server}, Tool: {item.arguments.tool}
        </Span>
      </TerminalFlex>
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
    case "read": {
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
  let thoughts = item.reasoningContent ? item.reasoningContent.trim() : item.reasoningContent;
  let content = item.content.trim();
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
          scrollbarGutter: "stable",
          scrollbarColor: SUBTLE_SCROLLBAR_COLOR,
          flexDirection: "column",
          borderColor: "gray",
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
              color: "gray",
            }}
          >
            {thoughts}
          </Span>
        </TerminalFlex>
      </TerminalFlex>
    </TerminalFlex>
  );
}
