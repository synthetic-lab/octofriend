import React, { useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { KbShortcutSelect, Item, ShortcutArray } from "./kb-select/kb-shortcut-select.tsx";

export function ConfirmDialog({
  confirmLabel,
  rejectLabel,
  onConfirm,
  onReject,
  rejectFirst = false,
  title,
  message,
}: {
  confirmLabel: string;
  rejectLabel: string;
  onConfirm: () => any;
  onReject: () => any;
  rejectFirst?: boolean;
  title?: string;
  message?: string;
}) {
  const items = [
    {
      type: "key" as const,
      mapping: rejectFirst
        ? {
            n: {
              label: rejectLabel,
              value: "reject" as const,
            },
            y: {
              label: confirmLabel,
              value: "confirm" as const,
            },
          }
        : {
            y: {
              label: confirmLabel,
              value: "confirm" as const,
            },
            n: {
              label: rejectLabel,
              value: "reject" as const,
            },
          },
    },
  ] satisfies ShortcutArray<"confirm" | "reject">;

  const onSelect = useCallback((item: Item<"confirm" | "reject">) => {
    if (item.value === "confirm") return onConfirm();
    return onReject();
  }, []);

  useInput((_, key) => {
    if (key.escape) {
      onReject();
    }
  });

  return (
    <Box flexDirection="column" gap={1}>
      {title && <Text bold>{title}</Text>}
      {message && <Text>{message}</Text>}
      <Box justifyContent="center">
        <KbShortcutSelect shortcutItems={items} onSelect={onSelect} />
      </Box>
    </Box>
  );
}
