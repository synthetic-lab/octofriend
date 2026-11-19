import React, { useCallback, useContext } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useAppStore, useModel } from "./state.ts";
import { useSession } from "./session-context.ts";
import { TransportContext } from "./transport-context.ts";
import { listPreviousSessions } from "./session-history/index.ts";
import { Auth, mergeEnvVar, useConfig, useSetConfig, Config } from "./config.ts";
import { ModelSetup } from "./components/auto-detect-models.tsx";
import { modelDisplayName, type SyntheticModel } from "./synthetic-models.ts";
import { ConfirmDialog } from "./components/confirm-dialog.tsx";
import { readAuthForModel } from "./config.ts";
import { SYNTHETIC_PROVIDER, providerForBaseUrl } from "./providers.ts";
import { KbShortcutPanel } from "./components/kb-select/kb-shortcut-panel.tsx";
import { Item, ShortcutArray, Keymap } from "./components/kb-select/kb-shortcut-select.tsx";
import { MenuQuotaIndicator } from "./components/menu-quota-indicator.tsx";
import { CustomAuthFlow } from "./components/add-model-flow.tsx";
import { useApp } from "paintcannon-react";
import { TerminalFlex } from "./components/terminal-flex.tsx";
import { LoadSessionMenu } from "./session-history/load-session-menu.tsx";
type MenuMode =
  | "main-menu"
  | "load-session"
  | "context-menu"
  | "settings-menu"
  | "model-select"
  | "add-model"
  | "set-default-model"
  | "quit-confirm"
  | "remove-model"
  | "clear-confirm"
  | "notifications-menu"
  | "usage-menu";
type MenuState = {
  menuMode: MenuMode;
  setMenuMode: (mode: MenuMode) => void;
};
const useMenuState = create<MenuState>((set, _) => ({
  menuMode: "main-menu",
  setMenuMode: menuMode => {
    set({
      menuMode,
    });
  },
}));
export function Menu({ syntheticModels }: { syntheticModels: SyntheticModel[] }) {
  const { menuMode, setMenuMode } = useMenuState(
    useShallow(state => ({
      menuMode: state.menuMode,
      setMenuMode: state.setMenuMode,
    })),
  );
  return (
    <TerminalFlex
      autoFocus
      style={{ flexDirection: "column", minHeight: 0, maxHeight: "100%" }}
      onKeyDown={event => {
        if (event.key === "Escape" && menuMode !== "main-menu") {
          event.preventDefault();
          event.stopPropagation();
          setMenuMode("main-menu");
        }
      }}
    >
      <MenuContent
        syntheticModels={syntheticModels}
        menuMode={menuMode}
        setMenuMode={setMenuMode}
      />
    </TerminalFlex>
  );
}

function MenuContent({
  syntheticModels,
  menuMode,
  setMenuMode,
}: {
  syntheticModels: SyntheticModel[];
  menuMode: MenuMode;
  setMenuMode: (mode: MenuMode) => void;
}) {
  if (menuMode === "main-menu") return <MainMenu />;
  if (menuMode === "load-session") {
    return <LoadSessionMenu onBack={() => setMenuMode("main-menu")} />;
  }
  if (menuMode === "context-menu") return <ContextMenu />;
  if (menuMode === "settings-menu") return <SettingsMenu />;
  if (menuMode === "model-select") return <SwitchModelMenu syntheticModels={syntheticModels} />;
  if (menuMode === "set-default-model") return <SetDefaultModelMenu />;
  if (menuMode === "quit-confirm") return <QuitConfirm />;
  if (menuMode === "clear-confirm") return <ClearConversationConfirm />;
  if (menuMode === "remove-model") return <RemoveModelMenu />;
  if (menuMode === "notifications-menu") return <NotificationsMenu />;
  if (menuMode === "usage-menu") return <UsageMenu />;
  const _: "add-model" = menuMode;
  return <AddModelMenuFlow syntheticModels={syntheticModels} />;
}
function SwitchModelMenu({ syntheticModels }: { syntheticModels: SyntheticModel[] }) {
  const { setModelOverride, toggleMenu } = useAppStore(
    useShallow(state => ({
      setModelOverride: state.setModelOverride,
      toggleMenu: state.toggleMenu,
    })),
  );
  const { setMenuMode } = useMenuState(
    useShallow(state => ({
      setMenuMode: state.setMenuMode,
    })),
  );
  const config = useConfig();
  const setConfig = useSetConfig();
  const [pendingModel, setPendingModel] = React.useState<null | Config["models"][number]>(null);
  const onSelect = useCallback(
    async (item: Item<`model-${string}` | "back">) => {
      if (item.value === "back") {
        setMenuMode("main-menu");
        return;
      }
      const target = item.value.replace("model-", "");
      const model = config.models.find(m => m.nickname === target)!;
      const auth = await readAuthForModel(model, config);
      if (!auth.ok) {
        setPendingModel(model);
        return;
      }
      setModelOverride(model);
      setMenuMode("main-menu");
      toggleMenu();
    },
    [config, setMenuMode, setModelOverride, toggleMenu],
  );
  if (pendingModel) {
    return (
      <CustomAuthFlow
        config={config}
        authData={
          pendingModel.type === "codex"
            ? {
                modelType: "codex",
              }
            : {
                modelType: pendingModel.type,
                baseUrl: pendingModel.baseUrl,
              }
        }
        onComplete={async (auth?: Auth) => {
          const index = config.models.indexOf(pendingModel);
          if (auth && index >= 0) {
            if (pendingModel.type === "codex") {
              if (auth.type === "codex") {
                const models = [...config.models];
                models[index] = {
                  ...pendingModel,
                  auth,
                };
                await setConfig({
                  ...config,
                  models,
                });
              }
            } else if (auth.type === "env") {
              await setConfig(mergeEnvVar(config, pendingModel, auth.name));
            } else if (auth.type === "command") {
              const models = [...config.models];
              models[index] = {
                ...pendingModel,
                auth,
              };
              await setConfig({
                ...config,
                models,
              });
            }
          }
          setModelOverride(pendingModel);
          setPendingModel(null);
          setMenuMode("main-menu");
          toggleMenu();
        }}
        onCancel={() => {
          setPendingModel(null);
        }}
      />
    );
  }
  const numericItems = config.models.map(model => {
    return {
      label: modelDisplayName(model, syntheticModels),
      value: `model-${model.nickname}` as const,
    };
  });
  const shortcutItems: ShortcutArray<`model-${string}` | "back"> = [
    {
      type: "auto-list" as const,
      order: numericItems,
    },
    {
      type: "key" as const,
      mapping: {
        b: {
          label: "Back to main menu",
          value: "back",
        },
      },
    },
  ];
  return (
    <KbShortcutPanel
      header="Which model should Octo use now?"
      shortcutItems={shortcutItems}
      onSelect={onSelect}
    />
  );
}
type SettingsValues = "set-default-model" | "remove-model";
const SETTINGS_ITEMS = {
  c: {
    label: "Change the default model",
    value: "set-default-model",
  },
  r: {
    label: "Remove a model",
    value: "remove-model",
  },
} satisfies Keymap<SettingsValues>;
function filterSettings(config: Config) {
  let items: Keymap<SettingsValues> = {};
  if (config.models.length > 1) {
    items = {
      ...items,
      c: SETTINGS_ITEMS.c,
      r: SETTINGS_ITEMS.r,
    };
  }
  return items;
}
function MainMenu() {
  const { toggleMenu, notify } = useAppStore(
    useShallow(state => ({
      toggleMenu: state.toggleMenu,
      notify: state.notify,
    })),
  );
  const session = useSession();
  const hasCompactableMessages = useAppStore(
    state =>
      state.sessionMode.mode === "live" &&
      state.sessionMode.trajectory.instance.hasCompactableHistory,
  );
  const hasPreviousSessions =
    listPreviousSessions(session.metadata.cwd, session.metadata.sessionId).length > 0;
  const { setMenuMode } = useMenuState(
    useShallow(state => ({
      setMenuMode: state.setMenuMode,
    })),
  );
  const config = useConfig();
  const setConfig = useSetConfig();
  const model = useModel();
  const provider = model.type === "codex" ? null : providerForBaseUrl(model.baseUrl);
  const isSynthetic = provider === SYNTHETIC_PROVIDER;
  type Value =
    | "model-select"
    | "add-model"
    | "load-session"
    | "vim-toggle"
    | "return"
    | "quit"
    | "context-menu"
    | "settings-menu"
    | "clear-confirm"
    | "notifications-menu"
    | "usage-menu";
  let items: Keymap<Value> = {
    m: {
      label: "⤭ Switch model",
      value: "model-select" as const,
    },
    a: {
      label: "+ Add a new model",
      value: "add-model" as const,
    },
    c: {
      label: "⦿ New conversation",
      value: "clear-confirm" as const,
    },
  };
  if (hasCompactableMessages) {
    items = {
      ...items,
      x: {
        label: "⧉ Context",
        value: "context-menu",
      },
    };
  }
  if (hasPreviousSessions) {
    items = {
      ...items,
      s: {
        label: "⥻ Load previous session",
        value: "load-session" as const,
      },
    };
  }
  if (config.vimEmulation?.enabled) {
    items = {
      ...items,
      e: {
        label: "♺ Switch to Emacs mode",
        value: "vim-toggle" as const,
      },
    };
  } else {
    items = {
      ...items,
      v: {
        label: "♺ Switch to Vim mode",
        value: "vim-toggle" as const,
      },
    };
  }
  if (config.notifications?.notifyCommand) {
    items = {
      ...items,
      n: {
        label: "🕭 Notifications",
        value: "notifications-menu" as const,
      },
    };
  }
  const settings = filterSettings(config);
  if (Object.values(settings).length !== 0) {
    items = {
      ...items,
      t: {
        label: "⛭ Settings",
        value: "settings-menu" as const,
      },
    };
  }
  if (isSynthetic) {
    items = {
      ...items,
      u: {
        label: "◷ Usage",
        value: "usage-menu" as const,
      },
    };
  }
  items = {
    ...items,
    b: {
      label: "⟵ Back to Octo",
      value: "return" as const,
    },
    q: {
      label: "× Quit",
      value: "quit" as const,
    },
  };
  const onSelect = useCallback(
    async (item: Item<Value>) => {
      if (item.value === "return") toggleMenu();
      else if (item.value === "quit") setMenuMode("quit-confirm");
      else if (item.value === "vim-toggle") {
        const wasEnabled = config.vimEmulation?.["enabled"] ?? false;

        // Write ONLY to config - single source of truth
        await setConfig({
          ...config,
          vimEmulation: {
            enabled: !wasEnabled,
          },
        });

        // Notify user
        notify(`Switched to ${wasEnabled ? "Emacs" : "Vim"} mode`);
        return;
      } else if (item.value === "clear-confirm") setMenuMode("clear-confirm");
      else setMenuMode(item.value);
    },
    [config, setConfig, notify, session],
  );
  return (
    <KbShortcutPanel
      header="Main Menu"
      shortcutItems={[
        {
          type: "key" as const,
          mapping: items,
        },
      ]}
      onSelect={onSelect}
    />
  );
}
function ContextMenu() {
  const setMenuMode = useMenuState(state => state.setMenuMode);
  const { closeMenu, notify, trajectoryMode } = useAppStore(
    useShallow(state => ({
      closeMenu: state.closeMenu,
      notify: state.notify,
      trajectoryMode:
        state.sessionMode.mode === "live" ? state.sessionMode.liveMode.trajectoryMode : null,
    })),
  );
  return (
    <KbShortcutPanel
      header="Context"
      shortcutItems={[
        {
          type: "key",
          mapping: {
            c: { label: "Compact session", value: "compact" },
            b: { label: "Back", value: "back" },
          },
        },
      ]}
      onSelect={item => {
        if (item.value === "back") {
          setMenuMode("main-menu");
          return;
        }
        setMenuMode("main-menu");
        closeMenu();
        if (
          trajectoryMode == null ||
          !("control" in trajectoryMode) ||
          !("requestCompaction" in trajectoryMode.control)
        )
          return;
        const accepted = trajectoryMode.control.requestCompaction();
        if (accepted) {
          notify(
            trajectoryMode.mode === "ready-for-request"
              ? "Session compaction requested."
              : "Session compaction queued.",
          );
        }
      }}
    />
  );
}
function SettingsMenu() {
  const { setMenuMode } = useMenuState(
    useShallow(state => ({
      setMenuMode: state.setMenuMode,
    })),
  );
  const config = useConfig();
  const settingsItems = filterSettings(config);
  const items: Keymap<SettingsValues | "back"> = {
    ...settingsItems,
    b: {
      label: "Back",
      value: "back" as const,
    },
  };
  const onSelect = useCallback((item: Item<SettingsValues | "back">) => {
    if (item.value === "back") setMenuMode("main-menu");
    else setMenuMode(item.value);
  }, []);
  return (
    <KbShortcutPanel
      header="Settings Menu"
      shortcutItems={[
        {
          type: "key" as const,
          mapping: items,
        },
      ]}
      onSelect={onSelect}
    />
  );
}
type NotificationValue = "always-notify" | "session-notify" | "notify-once" | "back";
function NotificationsMenu() {
  const { setMenuMode } = useMenuState(
    useShallow(state => ({
      setMenuMode: state.setMenuMode,
    })),
  );
  const config = useConfig();
  const setConfig = useSetConfig();
  const { sessionAutoNotify, notifyOnce, toggleMenu, setNotifyOnce, setNotifySession } =
    useAppStore(
      useShallow(state => ({
        sessionAutoNotify: state.sessionAutoNotify,
        notifyOnce: state.notifyOnce,
        toggleMenu: state.toggleMenu,
        setNotifyOnce: state.setNotifyOnce,
        setNotifySession: state.setNotifySession,
      })),
    );
  const alwaysNotify = config.notifications?.alwaysNotify;
  const items: Keymap<NotificationValue> = {
    o: {
      label: notifyOnce
        ? "Do not notify the next time Octo needs input"
        : "Notify the next time Octo needs input",
      value: "notify-once" as const,
    },
    s: {
      label: sessionAutoNotify
        ? "Stop auto-notifying this session"
        : "Auto-notify for the rest of this session",
      value: "session-notify" as const,
    },
    a: {
      label: alwaysNotify ? "Stop always auto-notifying" : "Always auto-notify",
      value: "always-notify" as const,
    },
    b: {
      label: "Back",
      value: "back" as const,
    },
  };
  const onSelect = useCallback(
    async (item: Item<NotificationValue>) => {
      if (item.value === "always-notify") {
        await setConfig({
          ...config,
          notifications: {
            ...config.notifications,
            alwaysNotify: !alwaysNotify,
          } as Config["notifications"],
        });
      } else if (item.value === "session-notify") {
        setNotifySession(!sessionAutoNotify);
      } else if (item.value === "notify-once") {
        setNotifyOnce(!notifyOnce);
        setMenuMode("main-menu");
        toggleMenu();
      } else if (item.value === "back") {
        setMenuMode("main-menu");
      }
    },
    [config, setConfig, alwaysNotify, sessionAutoNotify, notifyOnce, toggleMenu],
  );
  return (
    <KbShortcutPanel
      header="Notifications"
      shortcutItems={[
        {
          type: "key" as const,
          mapping: items,
        },
      ]}
      onSelect={onSelect}
    />
  );
}
function UsageMenu() {
  const { setMenuMode } = useMenuState(
    useShallow(state => ({
      setMenuMode: state.setMenuMode,
    })),
  );
  const onSelect = useCallback(
    (item: Item<"back">) => {
      if (item.value === "back") setMenuMode("main-menu");
    },
    [setMenuMode],
  );
  return (
    <KbShortcutPanel
      header="Usage"
      shortcutItems={[
        {
          type: "key" as const,
          mapping: {
            b: {
              label: "Back to main menu",
              value: "back" as const,
            },
          },
        },
      ]}
      onSelect={onSelect}
    >
      <MenuQuotaIndicator />
    </KbShortcutPanel>
  );
}
function QuitConfirm() {
  const { setMenuMode } = useMenuState(
    useShallow(state => ({
      setMenuMode: state.setMenuMode,
    })),
  );
  const app = useApp();
  const trajectory = useAppStore(state =>
    state.sessionMode.mode === "live" ? state.sessionMode.trajectory : null,
  );
  return (
    <ConfirmDialog
      confirmLabel="Yes, quit"
      rejectLabel="Never mind, take me back"
      onConfirm={async () => {
        if (trajectory != null) {
          trajectory.exitController.abort();
          await trajectory.finished;
        }
        app.exit();
      }}
      onReject={() => setMenuMode("main-menu")}
      rejectFirst={true}
    />
  );
}
function ClearConversationConfirm() {
  const { setMenuMode } = useMenuState(
    useShallow(state => ({
      setMenuMode: state.setMenuMode,
    })),
  );
  const { notify, newSession } = useAppStore(
    useShallow(state => ({
      notify: state.notify,
      newSession: state.sessionMode.mode === "live" ? state.sessionMode.control.newSession : null,
    })),
  );
  const session = useSession();
  const config = useConfig();
  const transport = useContext(TransportContext);
  return (
    <ConfirmDialog
      confirmLabel="Yes, start new conversation"
      rejectLabel="Never mind, take me back"
      onConfirm={async () => {
        if (newSession == null) return;
        const { cwd, cliArgs } = session.metadata;
        const oldSessionId = session.metadata.sessionId;
        await newSession(cwd, cliArgs, { config, transport });
        setMenuMode("main-menu");
        const resumeHint =
          oldSessionId != null
            ? ` To resume the previous session, run \`octo --resume ${oldSessionId}\``
            : "";
        notify(`New conversation started.${resumeHint}`);
      }}
      onReject={() => setMenuMode("main-menu")}
    />
  );
}
function SetDefaultModelMenu() {
  const { setModelOverride, toggleMenu } = useAppStore(
    useShallow(state => ({
      setModelOverride: state.setModelOverride,
      toggleMenu: state.toggleMenu,
    })),
  );
  const config = useConfig();
  const setConfig = useSetConfig();
  const { setMenuMode } = useMenuState(
    useShallow(state => ({
      setMenuMode: state.setMenuMode,
    })),
  );
  const numericItems = config.models.map(model => {
    return {
      label: model.nickname,
      value: `model-${model.nickname}` as const,
    };
  });
  const shortcutItems: ShortcutArray<`model-${string}` | "back"> = [
    {
      type: "auto-list" as const,
      order: numericItems,
    },
    {
      type: "key" as const,
      mapping: {
        b: {
          label: "Back to main menu",
          value: "back",
        },
      },
    },
  ];
  const onSelect = useCallback(
    async (item: Item<`model-${string}` | "back">) => {
      if (item.value === "back") {
        setMenuMode("main-menu");
        return;
      }
      const target = item.value.replace("model-", "");
      const model = config.models.find(m => m.nickname === target)!;
      const rest = config.models.filter(m => m.nickname !== target);
      await setConfig({
        ...config,
        models: [model, ...rest],
      });
      setModelOverride(model);
      setMenuMode("main-menu");
      toggleMenu();
    },
    [config, setModelOverride, toggleMenu],
  );
  return (
    <KbShortcutPanel
      header="Which model should be the default?"
      shortcutItems={shortcutItems}
      onSelect={onSelect}
    />
  );
}
function RemoveModelMenu() {
  const { setModelOverride, toggleMenu } = useAppStore(
    useShallow(state => ({
      setModelOverride: state.setModelOverride,
      toggleMenu: state.toggleMenu,
    })),
  );
  const config = useConfig();
  const setConfig = useSetConfig();
  const { setMenuMode } = useMenuState(
    useShallow(state => ({
      setMenuMode: state.setMenuMode,
    })),
  );
  const numericItems = config.models.map(model => {
    return {
      label: model.nickname,
      value: `model-${model.nickname}` as const,
    };
  });
  const shortcutItems: ShortcutArray<`model-${string}` | "back"> = [
    {
      type: "auto-list" as const,
      order: numericItems,
    },
    {
      type: "key" as const,
      mapping: {
        b: {
          label: "Back to main menu",
          value: "back",
        },
      },
    },
  ];
  const onSelect = useCallback(
    async (item: Item<`model-${string}` | "back">) => {
      if (item.value === "back") {
        setMenuMode("main-menu");
        return;
      }
      const target = item.value.replace("model-", "");
      const rest = config.models.filter(m => m.nickname !== target);
      await setConfig({
        ...config,
        models: [...rest],
      });
      const current = rest[0];
      setModelOverride(current);
      setMenuMode("main-menu");
      toggleMenu();
    },
    [config, setModelOverride, toggleMenu],
  );
  return (
    <KbShortcutPanel
      header="Which model do you want to remove?"
      shortcutItems={shortcutItems}
      onSelect={onSelect}
    />
  );
}
function AddModelMenuFlow({ syntheticModels }: { syntheticModels: SyntheticModel[] }) {
  const { setMenuMode } = useMenuState(
    useShallow(state => ({
      setMenuMode: state.setMenuMode,
    })),
  );
  const setConfig = useSetConfig();
  const config = useConfig();
  const onComplete = useCallback(
    async (models: Config["models"]) => {
      await setConfig({
        ...config,
        models: [...config.models, ...models],
      });
      setMenuMode("model-select");
    },
    [config, setConfig],
  );
  const onCancel = useCallback(() => {
    setMenuMode("main-menu");
  }, [setMenuMode]);
  const onOverrideDefaultApiKey = useCallback(
    async (overrides: Record<string, string>) => {
      await setConfig({
        ...config,
        defaultApiKeyOverrides: {
          ...(config.defaultApiKeyOverrides || {}),
          ...overrides,
        },
      });
    },
    [config, setConfig],
  );
  return (
    <ModelSetup
      syntheticModels={syntheticModels}
      config={config}
      onComplete={onComplete}
      onCancel={onCancel}
      onOverrideDefaultApiKey={onOverrideDefaultApiKey}
    />
  );
}
