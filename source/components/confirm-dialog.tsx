import React, { useCallback } from "react";
import { Box } from "ink";
import { KbShortcutSelect, Item, ShortcutArray } from "./kb-select/kb-shortcut-select.tsx";
import { KbShortcutPanel } from "./kb-select/kb-shortcut-panel.tsx";

export function ConfirmDialog({
  confirmLabel,
  rejectLabel,
  onConfirm,
  onReject,
  rejectFirst = false,
  title,
  subtitle,
}: {
  confirmLabel: string;
  rejectLabel: string;
  onConfirm: () => any;
  onReject: () => any;
  rejectFirst?: boolean;
  title?: string;
  subtitle?: string;
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

  return (
    <KbShortcutPanel title={title} subtitle={subtitle} shortcutItems={items} onSelect={onSelect} />
  );
}
