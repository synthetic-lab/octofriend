import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { IndicatorComponent, ItemComponent } from "./select.tsx";
import { Octo } from "./octo.tsx";

type Item<V> = {
  label: string,
  value: V,
}
type MenuPanelProps<V> = {
  items: Array<Item<V>>,
  readonly onSelect: (item: Item<V>) => any,
  title: string,
};

export const MenuHeader = React.memo(({ title }: { title: string }) => {
  return <Box justifyContent="center" marginBottom={1}>
    <Octo />
    <Box marginLeft={1}>
      <Text>{title}</Text>
    </Box>
  </Box>
});

export function MenuPanel<V>({ items, onSelect, title }: MenuPanelProps<V>) {
  return <Box flexDirection="column">
    <MenuHeader title={title} />
    <Box justifyContent="center">
      <SelectInput
        items={items}
        onSelect={onSelect}
        indicatorComponent={IndicatorComponent}
        itemComponent={ItemComponent}
      />
    </Box>
  </Box>
}
