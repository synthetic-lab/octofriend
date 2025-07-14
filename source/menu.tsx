import React, { useCallback } from "react";
import { create } from "zustand";
import { guard, statematch, fallback } from "statematch";
import { Text, Box, useInput } from "ink";
import SelectInput from "ink-select-input";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "./state.ts";
import { useConfig } from "./config.ts";
import { Octo } from "./components/octo.tsx";
import { IndicatorComponent, ItemComponent } from "./components/select.tsx";

type MenuMode = "main-menu"
              | "model-select"
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
  return <SwitchModelMenu />
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

  return <MenuPanel items={items} onSelect={onSelect} />
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

  useInput((_, key) => {
    if(key.escape) toggleMenu();
  });

  const items = [
    {
      label: "Switch model",
      value: "switch-model" as const,
    },
    {
      label: "Add a new model",
      value: "add-model" as const,
    },
    {
      label: "Return to Octo",
      value: "return" as const,
    },
  ];

	const onSelect = useCallback((item: (typeof items)[number]) => {
    statematch([
      guard(() => item.value === "switch-model").run(() => {
        setMenuMode("model-select");
      }),
      guard(() => item.value === "add-model").run(() => {
      }),
      fallback(() => {
        toggleMenu();
      }),
    ]);
	}, []);

  return <MenuPanel items={items} onSelect={onSelect} />
}

type Item<V> = {
  label: string,
  value: V,
}
type MenuPanelProps<V> = {
  items: Array<Item<V>>,
  readonly onSelect: (item: Item<V>) => any,
};

function MenuPanel<V>({ items, onSelect }: MenuPanelProps<V>) {
  return <Box flexDirection="column">
    <Box justifyContent="center">
      <Octo />
      <Box marginLeft={1}>
        <Text>Menu</Text>
      </Box>
    </Box>
    <Box justifyContent="center" marginTop={1}>
      <SelectInput
        items={items}
        onSelect={onSelect}
        indicatorComponent={IndicatorComponent}
        itemComponent={ItemComponent}
      />
    </Box>
  </Box>
}
