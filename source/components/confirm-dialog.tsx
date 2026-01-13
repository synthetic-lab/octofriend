import React, { useCallback } from "react";
import { Box } from "ink";
import SelectInput from "./ink/select-input.tsx";
import { IndicatorComponent, ItemComponent } from "./select.tsx";

export function ConfirmDialog({
  confirmLabel,
  rejectLabel,
  onConfirm,
  onReject,
}: {
  confirmLabel: string;
  rejectLabel: string;
  onConfirm: () => any;
  onReject: () => any;
}) {
  const items = [
    {
      label: confirmLabel,
      value: "confirm" as const,
    },
    {
      label: rejectLabel,
      value: "reject" as const,
    },
  ];
  const onSelect = useCallback((item: (typeof items)[number]) => {
    if (item.value === "confirm") return onConfirm();
    return onReject();
  }, []);

  return (
    <Box justifyContent="center">
      <SelectInput
        items={items}
        onSelect={onSelect}
        indicatorComponent={IndicatorComponent}
        itemComponent={ItemComponent}
      />
    </Box>
  );
}
