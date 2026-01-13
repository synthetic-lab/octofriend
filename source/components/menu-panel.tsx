import React from "react";
import { Box, Text } from "ink";
import SelectInput from "./ink/select-input.tsx";
import { IndicatorComponent, ItemComponent } from "./select.tsx";
import { Octo } from "./octo.tsx";

type Item<V> = {
  label: string;
  value: V;
};
type MenuPanelProps<V> = {
  items: Array<Item<V>>;
  readonly onSelect: (item: Item<V>) => any;
  title: string;
  children?: React.ReactNode;
};

export const MenuHeader = React.memo(({ title }: { title: string }) => {
  return (
    <Box justifyContent="center" marginBottom={1}>
      <Box justifyContent="center" width={80}>
        <Octo />
        <Box marginLeft={1}>
          <Text>{title}</Text>
        </Box>
      </Box>
    </Box>
  );
});

export function MenuPanel<V>({ items, onSelect, title, children }: MenuPanelProps<V>) {
  return (
    <Box flexDirection="column">
      <MenuHeader title={title} />
      {children && (
        <Box justifyContent="center" alignItems="center" marginBottom={1}>
          <Box flexDirection="column" width={80}>
            {children}
          </Box>
        </Box>
      )}
      <Box justifyContent="center">
        <SelectInput
          items={items}
          onSelect={onSelect}
          indicatorComponent={IndicatorComponent}
          itemComponent={ItemComponent}
        />
      </Box>
    </Box>
  );
}
