import React, { useCallback } from "react";
import { create } from "zustand";
import { useInput, useApp, Text } from "ink";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "./state.ts";
import { useConfig, useSetConfig, Config } from "./config.ts";
import { ModelSetup } from "./components/auto-detect-models.tsx";
import { AutofixModelMenu } from "./components/autofix-model-menu.tsx";
import { ConfirmDialog } from "./components/confirm-dialog.tsx";
import { SetApiKey } from "./components/set-api-key.tsx";
import { readKeyForModel } from "./config.ts";
import { keyFromName, SYNTHETIC_PROVIDER } from "./providers.ts";
import { KbShortcutPanel } from "./components/kb-select/kb-shortcut-panel.tsx";
import { Item, ShortcutArray } from "./components/kb-select/kb-shortcut-select.tsx";

type MenuMode =
  | "main-menu"
  | "settings-menu"
  | "model-select"
  | "add-model"
  | "diff-apply-toggle"
  | "fix-json-toggle"
  | "set-default-model"
  | "quit-confirm"
  | "remove-model";
type MenuState = {
  menuMode: MenuMode;
  setMenuMode: (mode: MenuMode) => void;
};

const useMenuState = create<MenuState>((set, _) => ({
  menuMode: "main-menu",
  setMenuMode: menuMode => {
    set({ menuMode });
  },
}));

export function Menu() {
  const { menuMode } = useMenuState(
    useShallow(state => ({
      menuMode: state.menuMode,
    })),
  );

  if (menuMode === "main-menu") return <MainMenu />;
  if (menuMode === "settings-menu") return <SettingsMenu />;
  if (menuMode === "model-select") return <SwitchModelMenu />;
  if (menuMode === "set-default-model") return <SetDefaultModelMenu />;
  if (menuMode === "quit-confirm") return <QuitConfirm />;
  if (menuMode === "remove-model") return <RemoveModelMenu />;
  if (menuMode === "diff-apply-toggle") return <DiffApplyToggle />;
  if (menuMode === "fix-json-toggle") return <FixJsonToggle />;
  const _: "add-model" = menuMode;
  return <AddModelMenuFlow />;
}

function AutofixToggle({
  configKey,
  modelNickname,
  disableNotification,
  enableNotification,
  defaultModel,
  children,
}: {
  disableNotification: string;
  enableNotification: string;
  defaultModel: string;
  modelNickname: string;
  configKey: "diffApply" | "fixJson";
  children: React.ReactNode;
}) {
  const config = useConfig();
  const setConfig = useSetConfig();
  const { setMenuMode } = useMenuState(
    useShallow(state => ({
      setMenuMode: state.setMenuMode,
    })),
  );
  const { toggleMenu, notify } = useAppStore(
    useShallow(state => ({
      toggleMenu: state.toggleMenu,
      notify: state.notify,
    })),
  );

  useInput((_, key) => {
    if (key.escape) setMenuMode("main-menu");
  });

  if (config[configKey]) {
    return (
      <ConfirmDialog
        rejectLabel={`Disable ${modelNickname}`}
        confirmLabel={`Keep ${modelNickname} on (recommended)`}
        onReject={async () => {
          const newconf = { ...config };
          delete newconf[configKey];
          await setConfig(newconf);
          setMenuMode("main-menu");
          toggleMenu();
          notify(disableNotification);
        }}
        onConfirm={() => {
          setMenuMode("main-menu");
        }}
      />
    );
  }
  return (
    <AutofixModelMenu
      defaultModel={defaultModel}
      modelNickname={modelNickname}
      config={config}
      onOverrideDefaultApiKey={async apiEnvVar => {
        await setConfig({
          ...config,
          defaultApiKeyOverrides: {
            ...(config.defaultApiKeyOverrides || {}),
            [keyFromName(SYNTHETIC_PROVIDER.name)]: apiEnvVar,
          },
        });
      }}
      onComplete={async setting => {
        await setConfig({
          ...config,
          [configKey]: setting,
        });
        setMenuMode("main-menu");
        toggleMenu();
        notify(enableNotification);
      }}
      onCancel={() => {
        setMenuMode("main-menu");
      }}
    >
      {children}
    </AutofixModelMenu>
  );
}

function DiffApplyToggle() {
  return (
    <AutofixToggle
      defaultModel="hf:syntheticlab/diff-apply"
      configKey="diffApply"
      modelNickname="diff-apply"
      enableNotification="Fast diff apply enabled"
      disableNotification="Fast diff apply disabled"
    >
      <Text>
        Even good coding models sometimes make minor mistakes generating code diffs, which can cause
        slow retries and can confuse them, since models often aren't trained as well to handle edit
        failures as they are successes. Diff-apply is a fast, small model that fixes minor code diff
        edit inaccuracies. It speeds up iteration and can significantly improve model performance.
      </Text>
    </AutofixToggle>
  );
}

function FixJsonToggle() {
  return (
    <AutofixToggle
      defaultModel="hf:syntheticlab/fix-json"
      configKey="fixJson"
      modelNickname="fix-json"
      enableNotification="JSON auto-fix enabled"
      disableNotification="JSON auto-fix disabled"
    >
      <Text>
        Octo uses tools to work with your underlying codebase. Some model providers don't support
        strict constraints on how tool calls are generated, and models can make mistakes generating
        JSON, the format used for all of Octo's tool calls.
      </Text>
      <Text>
        The fix-json model can automatically fix broken JSON for Octo, helping models avoid failures
        more quickly and cheaply than retrying the main model. It also may help reduce the main
        model's confusion.
      </Text>
    </AutofixToggle>
  );
}

function SwitchModelMenu() {
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
  const [pendingModel, setPendingModel] = React.useState<null | Config["models"][number]>(null);

  useInput((_, key) => {
    if (key.escape && pendingModel == null) setMenuMode("main-menu");
  });

  if (pendingModel) {
    return (
      <SetApiKey
        baseUrl={pendingModel.baseUrl}
        onComplete={() => {
          setModelOverride(pendingModel.nickname);
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
      label: model.nickname,
      value: `model-${model.nickname}` as const,
    };
  });

  const shortcutItems: ShortcutArray<`model-${string}` | "back"> = [
    {
      type: "number" as const,
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

      if (!model.apiEnvVar) {
        const key = await readKeyForModel(model, config);
        if (key == null) {
          setPendingModel(model);
          return;
        }
      }

      setModelOverride(target);
      setMenuMode("main-menu");
      toggleMenu();
    },
    [config],
  );

  return (
    <KbShortcutPanel
      title="Which model should Octo use now?"
      shortcutItems={shortcutItems}
      onSelect={onSelect}
    />
  );
}

type SettingsValues =
  | "set-default-model"
  | "remove-model"
  | "disable-diff-apply"
  | "disable-fix-json";
const SETTINGS_ITEMS = {
  c: {
    label: "Change the default model",
    value: "set-default-model",
  },
  r: {
    label: "Remove a model",
    value: "remove-model",
  },
  d: {
    label: "Disable fast diff application",
    value: "disable-diff-apply",
  },
  t: {
    label: "Disable auto-fixing JSON tool calls",
    value: "disable-fix-json",
  },
} satisfies Record<string, Item<SettingsValues>>;
function filterSettings(config: Config) {
  let items: Record<string, Item<SettingsValues>> = {};
  if (config.models.length > 1) {
    items = {
      ...items,
      c: SETTINGS_ITEMS.c,
      r: SETTINGS_ITEMS.r,
    };
  }
  if (config.diffApply) {
    items = {
      ...items,
      d: SETTINGS_ITEMS.d,
    };
  }
  if (config.fixJson) {
    items = {
      ...items,
      t: SETTINGS_ITEMS.t,
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

  const { setMenuMode } = useMenuState(
    useShallow(state => ({
      setMenuMode: state.setMenuMode,
    })),
  );

  const config = useConfig();
  const setConfig = useSetConfig();

  useInput((_, key) => {
    if (key.escape) toggleMenu();
  });

  type Value =
    | "model-select"
    | "add-model"
    | "vim-toggle"
    | "return"
    | "quit"
    | "fix-json-toggle"
    | "diff-apply-toggle"
    | "settings-menu";
  let items: Record<string, Item<Value>> = {
    m: {
      label: "⤭ Switch model",
      value: "model-select" as const,
    },
    n: {
      label: "+ Add a new model",
      value: "add-model" as const,
    },
  };

  if (config.vimEmulation?.enabled) {
    items = {
      ...items,
      e: {
        label: "- Switch to Emacs mode",
        value: "vim-toggle" as const,
      },
    };
  } else {
    items = {
      ...items,
      v: {
        label: "- Switch to Vim mode",
        value: "vim-toggle" as const,
      },
    };
  }

  if (config.fixJson == null) {
    items = {
      ...items,
      j: {
        label: "🪄 Enable auto-fixing JSON tool calls",
        value: "fix-json-toggle" as const,
      },
    };
  }
  if (config.diffApply == null) {
    items = {
      ...items,
      d: {
        label: "💫 Enable fast diff application",
        value: "diff-apply-toggle" as const,
      },
    };
  }

  const settings = filterSettings(config);
  if (Object.values(settings).length !== 0) {
    items = {
      ...items,
      t: {
        label: "* Settings",
        value: "settings-menu" as const,
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
    async (item: (typeof items)[string]) => {
      if (item.value === "return") toggleMenu();
      else if (item.value === "quit") setMenuMode("quit-confirm");
      else if (item.value === "vim-toggle") {
        const wasEnabled = config.vimEmulation?.["enabled"] ?? false;

        // Write ONLY to config - single source of truth
        await setConfig({ ...config, vimEmulation: { enabled: !wasEnabled } });

        // Notify user
        notify(`Switched to ${wasEnabled ? "Emacs" : "Vim"} mode`);
        return;
      } else setMenuMode(item.value);
    },
    [config, setConfig, notify],
  );

  return (
    <KbShortcutPanel
      title="Main Menu"
      shortcutItems={[{ type: "key" as const, mapping: items }]}
      onSelect={onSelect}
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

  useInput((_, key) => {
    if (key.escape) setMenuMode("main-menu");
  });

  const settingsItems = filterSettings(config);
  let items: Record<string, Item<SettingsValues | "back">> = {
    ...settingsItems,
    b: {
      label: "Back",
      value: "back" as const,
    },
  };

  const onSelect = useCallback((item: (typeof items)[string]) => {
    if (item.value === "disable-diff-apply") setMenuMode("diff-apply-toggle");
    else if (item.value === "disable-fix-json") setMenuMode("fix-json-toggle");
    else if (item.value === "back") setMenuMode("main-menu");
    else setMenuMode(item.value);
  }, []);

  return (
    <KbShortcutPanel
      title="Settings Menu"
      shortcutItems={[{ type: "key" as const, mapping: items }]}
      onSelect={onSelect}
    />
  );
}

function QuitConfirm() {
  const { setMenuMode } = useMenuState(
    useShallow(state => ({
      setMenuMode: state.setMenuMode,
    })),
  );
  const app = useApp();

  useInput((_, key) => {
    if (key.escape) setMenuMode("main-menu");
  });

  const items: Record<string, Item<"no" | "yes">> = {
    n: {
      label: "Never mind, take me back",
      value: "no" as const,
    },
    y: {
      label: "Yes, quit",
      value: "yes" as const,
    },
  };

  const onSelect = useCallback((item: (typeof items)[string]) => {
    if (item.value === "no") setMenuMode("main-menu");
    else app.exit();
  }, []);

  return (
    <KbShortcutPanel
      title="Are you sure you want to quit?"
      shortcutItems={[{ type: "key" as const, mapping: items }]}
      onSelect={onSelect}
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

  useInput((_, key) => {
    if (key.escape) setMenuMode("main-menu");
  });

  const numericItems = config.models.map(model => {
    return {
      label: model.nickname,
      value: `model-${model.nickname}` as const,
    };
  });

  const shortcutItems: ShortcutArray<`model-${string}` | "back"> = [
    {
      type: "number" as const,
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
      setModelOverride(target);
      setMenuMode("main-menu");
      toggleMenu();
    },
    [config],
  );

  return (
    <KbShortcutPanel
      title="Which model should be the default?"
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

  useInput((_, key) => {
    if (key.escape) setMenuMode("main-menu");
  });

  const numericItems = config.models.map(model => {
    return {
      label: model.nickname,
      value: `model-${model.nickname}` as const,
    };
  });

  const shortcutItems: ShortcutArray<`model-${string}` | "back"> = [
    {
      type: "number" as const,
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
      setModelOverride(current.nickname);
      setMenuMode("main-menu");
      toggleMenu();
    },
    [config],
  );

  return (
    <KbShortcutPanel
      title="Which model do you want to remove?"
      shortcutItems={shortcutItems}
      onSelect={onSelect}
    />
  );
}

function AddModelMenuFlow() {
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
      config={config}
      onComplete={onComplete}
      onCancel={onCancel}
      onOverrideDefaultApiKey={onOverrideDefaultApiKey}
    />
  );
}
