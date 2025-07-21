import React, { useCallback } from "react";
import { create } from "zustand";
import { useInput, useApp } from "ink";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "./state.ts";
import { useConfig, useSetConfig, Config } from "./config.ts";
import { MenuPanel } from "./components/menu-panel.tsx";
import { ModelSetup } from "./components/auto-detect-models.tsx";

type MenuMode = "main-menu"
              | "model-select"
              | "add-model"
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
  if(menuMode === "model-select") return <SwitchModelMenu />
  if(menuMode === "set-default-model") return <SetDefaultModelMenu />
  if(menuMode === "quit-confirm") return <QuitConfirm />
  if(menuMode === "remove-model") return <RemoveModelMenu />
  const _: "add-model" = menuMode;
  return <AddModelMenuFlow />
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

    setModelOverride(item.value.replace("model-", ""));
    setMenuMode("main-menu");
    toggleMenu();
	}, []);

  return <MenuPanel title="Which model should Octo use now?" items={items} onSelect={onSelect} />
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
      label: "Switch model",
      value: "model-select" as const,
    },
    {
      label: "Add a new model",
      value: "add-model" as const,
    },
    {
      label: "Change the default model",
      value: "set-default-model" as const,
    },
    {
      label: "Remove a model",
      value: "remove-model" as const,
    },
    {
      label: "Return to Octo",
      value: "return" as const,
    },
    {
      label: "Quit",
      value: "quit" as const,
    },
  ];

  if(config.models.length === 1) {
    items = items.filter(item => {
      if(item.value === "model-select") return false;
      if(item.value === "remove-model") return false;
      if(item.value === "set-default-model") return false;
      return true;
    });
  }

	const onSelect = useCallback((item: (typeof items)[number]) => {
    if(item.value === "return") toggleMenu();
    else if(item.value === "quit") setMenuMode("quit-confirm");
    else setMenuMode(item.value);
	}, []);

  return <MenuPanel title="Main Menu" items={items} onSelect={onSelect} />
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

	const onSelect = useCallback((item: (typeof items)[number]) => {
    if(item.value === "back") {
      setMenuMode("main-menu");
      return;
    }
    const target = item.value.replace("model-", "")
    const model = config.models.find(m => m.nickname === target)!;
    const rest = config.models.filter(m => m.nickname !== target);
    setConfig({
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

	const onSelect = useCallback((item: (typeof items)[number]) => {
    if(item.value === "back") {
      setMenuMode("main-menu");
      return;
    }
    const target = item.value.replace("model-", "")
    const rest = config.models.filter(m => m.nickname !== target);
    setConfig({
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

  const onComplete = useCallback((model: Config["models"][number]) => {
    setConfig({
      ...config,
      models: [
        ...config.models,
        model,
      ],
    });
    setMenuMode("model-select");
  }, [ config, setConfig ]);

  const onCancel = useCallback(() => {
    setMenuMode("main-menu");
  }, [ setMenuMode ]);

  return <AddModelFlow onComplete={onComplete} onCancel={onCancel} />
}
