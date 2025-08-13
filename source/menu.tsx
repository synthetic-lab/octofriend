import React, { useCallback } from "react";
import { create } from "zustand";
import { useInput, useApp, Text } from "ink";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "./state.ts";
import { useConfig, useSetConfig, Config } from "./config.ts";
import { MenuPanel } from "./components/menu-panel.tsx";
import { ModelSetup } from "./components/auto-detect-models.tsx";
import { AutofixModelMenu } from "./components/autofix-model-menu.tsx";
import { ConfirmDialog } from "./components/confirm-dialog.tsx";
import { SetApiKey } from "./components/set-api-key.tsx";
import { readKeyForModel } from "./config.ts";
import { keyFromName, SYNTHETIC_PROVIDER } from "./components/providers.ts";

type MenuMode = "main-menu"
              | "settings-menu"
              | "model-select"
              | "add-model"
              | "diff-apply-toggle"
              | "fix-json-toggle"
              | "set-default-model"
              | "quit-confirm"
              | "remove-model"
              ;
type MenuState = {
  menuMode: MenuMode,
  setMenuMode: (mode: MenuMode) => void,
};

const useMenuState = create<MenuState>((set, _) => ({
  menuMode: "main-menu",
  setMenuMode: menuMode => {
    set({ menuMode });
  },
}));

export function Menu() {
  const { menuMode } = useMenuState(useShallow(state => ({
    menuMode: state.menuMode,
  })));

  if(menuMode === "main-menu") return <MainMenu />
  if(menuMode === "settings-menu") return <SettingsMenu />
  if(menuMode === "model-select") return <SwitchModelMenu />
  if(menuMode === "set-default-model") return <SetDefaultModelMenu />
  if(menuMode === "quit-confirm") return <QuitConfirm />
  if(menuMode === "remove-model") return <RemoveModelMenu />
  if(menuMode === "diff-apply-toggle") return <DiffApplyToggle />
  if(menuMode === "fix-json-toggle") return <FixJsonToggle />
  const _: "add-model" = menuMode;
  return <AddModelMenuFlow />
}

function AutofixToggle({
  configKey, modelNickname, disableNotification, enableNotification, defaultModel, children
}: {
  disableNotification: string,
  enableNotification: string,
  defaultModel: string,
  modelNickname: string,
  configKey: "diffApply" | "fixJson",
  children: React.ReactNode,
}) {
  const config = useConfig();
  const setConfig = useSetConfig();
  const { setMenuMode } = useMenuState(useShallow(state => ({
    setMenuMode: state.setMenuMode,
  })));
  const { toggleMenu, notify } = useAppStore(useShallow(state => ({
    toggleMenu: state.toggleMenu,
    notify: state.notify,
  })));

  useInput((_, key) => {
    if(key.escape) setMenuMode("main-menu");
  });

  if(config[configKey]) {
    return <ConfirmDialog
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
  }
  return <AutofixModelMenu
    defaultModel={defaultModel}
    modelNickname={modelNickname}
    config={config}
    onOverrideDefaultApiKey={async (apiEnvVar) => {
      await setConfig({
        ...config,
        defaultApiKeyOverrides: {
          ...(config.defaultApiKeyOverrides || {}),
          [keyFromName(SYNTHETIC_PROVIDER.name)]: apiEnvVar,
        },
      });
    }}
    onComplete={async (setting) => {
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
    { children }
  </AutofixModelMenu>
}

function DiffApplyToggle() {
  return <AutofixToggle
    defaultModel="hf:syntheticlab/diff-apply"
    configKey="diffApply"
    modelNickname="diff-apply"
    enableNotification="Fast diff apply enabled"
    disableNotification="Fast diff apply disabled"
  >
    <Text>
      Even good coding models sometimes make minor mistakes generating code diffs, which can cause
      slow retries and can confuse them, since models often aren't trained as well to handle
      edit failures as they are successes. Diff-apply is a fast, small model that fixes minor
      code diff edit inaccuracies. It speeds up iteration and can significantly improve model
      performance.
    </Text>
  </AutofixToggle>
}

function FixJsonToggle() {
  return <AutofixToggle
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
}

function SwitchModelMenu() {
  const { setModelOverride, toggleMenu } = useAppStore(useShallow(state => ({
    setModelOverride: state.setModelOverride,
    toggleMenu: state.toggleMenu,
  })));

  const { setMenuMode } = useMenuState(useShallow(state => ({
    setMenuMode: state.setMenuMode,
  })));

  const config = useConfig();
  const [ pendingModel, setPendingModel ] = React.useState<null | Config["models"][number]>(null);

  useInput((_, key) => {
    if(key.escape && pendingModel == null) setMenuMode("main-menu");
  });

  if(pendingModel) {
    return <SetApiKey
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
  }

  const items = [
    ...config.models.map(model => {
      return {
        label: model.nickname,
        value: `model-${model.nickname}`,
      };
    }),
    {
      label: "Back to main menu",
      value: "back",
    },
  ];

	const onSelect = useCallback(async (item: (typeof items)[number]) => {
    if(item.value === "back") {
      setMenuMode("main-menu");
      return;
    }

    const target = item.value.replace("model-", "");
    const model = config.models.find(m => m.nickname === target)!;

    if(!model.apiEnvVar) {
      const key = await readKeyForModel(model, config);
      if(key == null) {
        setPendingModel(model);
        return;
      }
    }

    setModelOverride(target);
    setMenuMode("main-menu");
    toggleMenu();
	}, [ config ]);

  return <MenuPanel title="Which model should Octo use now?" items={items} onSelect={onSelect} />
}

const SETTINGS_ITEMS = [
  {
    label: "Change the default model",
    value: "set-default-model" as const,
  },
  {
    label: "Remove a model",
    value: "remove-model" as const,
  },
  {
    label: "Disable fast diff application",
    value: "disable-diff-apply" as const,
  },
  {
    label: "Disable auto-fixing JSON tool calls",
    value: "disable-fix-json" as const,
  },
];
function filterSettings(config: Config) {
  let items = SETTINGS_ITEMS.concat([]);
  items = items.filter(item => {
    if(config.diffApply == null && item.value === "disable-diff-apply") return false;
    if(config.fixJson == null && item.value === "disable-fix-json") return false;
    return true;
  });

  if(config.models.length > 1) return items;

  return items.filter(item => {
    if(item.value === "remove-model") return false;
    if(item.value === "set-default-model") return false;
    return true;
  });
}

function MainMenu() {
  const { toggleMenu } = useAppStore(
    useShallow(state => ({
      toggleMenu: state.toggleMenu,
    }))
  );

  const { setMenuMode } = useMenuState(useShallow(state => ({
    setMenuMode: state.setMenuMode,
  })));

  const config = useConfig();

  useInput((_, key) => {
    if(key.escape) toggleMenu();
  });

  let items = [
    {
      label: "💫 Enable fast diff application",
      value: "diff-apply-toggle" as const,
    },
    {
      label: "🪄 Enable auto-fixing JSON tool calls",
      value: "fix-json-toggle" as const,
    },
    {
      label: "⤭ Switch model",
      value: "model-select" as const,
    },
    {
      label: "+ Add a new model",
      value: "add-model" as const,
    },
    {
      label: "* Settings",
      value: "settings-menu" as const,
    },
    {
      label: "⟵ Return to Octo",
      value: "return" as const,
    },
    {
      label: "× Quit",
      value: "quit" as const,
    },
  ];
  items = items.filter(item => {
    if(config.diffApply != null && item.value === "diff-apply-toggle") return false;
    if(config.fixJson != null && item.value === "fix-json-toggle") return false;
    return true;
  });

  const settingsItems = filterSettings(config);
  if(settingsItems.length === 0) {
    items = items.filter(item => item.value !== "settings-menu");
  }

	const onSelect = useCallback((item: (typeof items)[number]) => {
    if(item.value === "return") toggleMenu();
    else if(item.value === "quit") setMenuMode("quit-confirm");
    else setMenuMode(item.value);
	}, []);

  return <MenuPanel title="Main Menu" items={items} onSelect={onSelect} />
}

function SettingsMenu() {
  const { setMenuMode } = useMenuState(useShallow(state => ({
    setMenuMode: state.setMenuMode,
  })));

  const config = useConfig();

  useInput((_, key) => {
    if(key.escape) setMenuMode("main-menu");
  });

  const settingsItems = filterSettings(config);
  let items = [
    ...settingsItems,
    {
      label: "Back",
      value: "back" as const,
    },
  ];

	const onSelect = useCallback((item: (typeof items)[number]) => {
    if(item.value === "disable-diff-apply") setMenuMode("diff-apply-toggle");
    else if(item.value === "disable-fix-json") setMenuMode("fix-json-toggle");
    else if(item.value === "back") setMenuMode("main-menu");
    else setMenuMode(item.value);
	}, []);

  return <MenuPanel title="Settings Menu" items={items} onSelect={onSelect} />
}

function QuitConfirm() {
  const { setMenuMode } = useMenuState(useShallow(state => ({
    setMenuMode: state.setMenuMode,
  })));
  const app = useApp();

  useInput((_, key) => {
    if(key.escape) setMenuMode("main-menu");
  });

  const items = [
    {
      label: "Never mind, take me back",
      value: "no" as const,
    },
    {
      label: "Yes, quit",
      value: "yes" as const,
    }
  ];

	const onSelect = useCallback((item: (typeof items)[number]) => {
    if(item.value === "no") setMenuMode("main-menu");
    else app.exit();
	}, []);

  return <MenuPanel title="Are you sure you want to quit?" items={items} onSelect={onSelect} />
}

function SetDefaultModelMenu() {
  const { setModelOverride, toggleMenu } = useAppStore(useShallow(state => ({
    setModelOverride: state.setModelOverride,
    toggleMenu: state.toggleMenu,
  })));

  const config = useConfig();
  const setConfig = useSetConfig();
  const { setMenuMode } = useMenuState(useShallow(state => ({
    setMenuMode: state.setMenuMode,
  })));

  useInput((_, key) => {
    if(key.escape) setMenuMode("main-menu");
  });

  const items = [
    ...config.models.map(model => {
      return {
        label: model.nickname,
        value: `model-${model.nickname}`,
      };
    }),
    {
      label: "Back to main menu",
      value: "back",
    },
  ];

	const onSelect = useCallback(async (item: (typeof items)[number]) => {
    if(item.value === "back") {
      setMenuMode("main-menu");
      return;
    }
    const target = item.value.replace("model-", "")
    const model = config.models.find(m => m.nickname === target)!;
    const rest = config.models.filter(m => m.nickname !== target);
    await setConfig({
      ...config,
      models: [
        model,
        ...rest,
      ],
    });
    setModelOverride(target);
    setMenuMode("main-menu");
    toggleMenu();
	}, [ config ]);

  return <MenuPanel title="Which model should be the default?" items={items} onSelect={onSelect} />
}

function RemoveModelMenu() {
  const { setModelOverride, toggleMenu } = useAppStore(useShallow(state => ({
    setModelOverride: state.setModelOverride,
    toggleMenu: state.toggleMenu,
  })));

  const config = useConfig();
  const setConfig = useSetConfig();
  const { setMenuMode } = useMenuState(useShallow(state => ({
    setMenuMode: state.setMenuMode,
  })));

  useInput((_, key) => {
    if(key.escape) setMenuMode("main-menu");
  });

  const items = [
    ...config.models.map(model => {
      return {
        label: model.nickname,
        value: `model-${model.nickname}`,
      };
    }),
    {
      label: "Back to main menu",
      value: "back",
    },
  ];

	const onSelect = useCallback(async (item: (typeof items)[number]) => {
    if(item.value === "back") {
      setMenuMode("main-menu");
      return;
    }
    const target = item.value.replace("model-", "")
    const rest = config.models.filter(m => m.nickname !== target);
    await setConfig({
      ...config,
      models: [
        ...rest,
      ],
    });
    const current = rest[0];
    setModelOverride(current.nickname);
    setMenuMode("main-menu");
    toggleMenu();
	}, [ config ]);

  return <MenuPanel title="Which model do you want to remove?" items={items} onSelect={onSelect} />
}

function AddModelMenuFlow() {
  const { setMenuMode } = useMenuState(useShallow(state => ({
    setMenuMode: state.setMenuMode,
  })));
  const setConfig = useSetConfig();
  const config = useConfig();

  const onComplete = useCallback(async (models: Config["models"]) => {
    await setConfig({
      ...config,
      models: [
        ...config.models,
        ...models,
      ],
    });
    setMenuMode("model-select");
  }, [ config, setConfig ]);

  const onCancel = useCallback(() => {
    setMenuMode("main-menu");
  }, [ setMenuMode ]);

  const onOverrideDefaultApiKey = useCallback(async (overrides: Record<string, string>) => {
    await setConfig({
      ...config,
      defaultApiKeyOverrides: {
        ...(config.defaultApiKeyOverrides || {}),
        ...overrides,
      },
    });
  }, [ config, setConfig ]);

  return <ModelSetup
    config={config}
    onComplete={onComplete}
    onCancel={onCancel}
    onOverrideDefaultApiKey={onOverrideDefaultApiKey}
  />
}
