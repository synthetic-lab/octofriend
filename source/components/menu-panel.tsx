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
export function MenuPanel<V>({ items, onSelect, title }: MenuPanelProps<V>) {
  return <Box flexDirection="column">
    <Box justifyContent="center">
      <Octo />
      <Box marginLeft={1}>
        <Text>{title}</Text>
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
