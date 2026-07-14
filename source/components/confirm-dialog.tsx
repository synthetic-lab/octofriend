import React, { useCallback } from "react";
import { KbShortcutSelect, Item, ShortcutArray } from "./kb-select/kb-shortcut-select.tsx";
import { Div } from "paintcannon-react";
export function ConfirmDialog({
  confirmLabel,
  rejectLabel,
  onConfirm,
  onReject,
  rejectFirst = false,
}: {
  confirmLabel: string;
  rejectLabel: string;
  onConfirm: () => any;
  onReject: () => any;
  rejectFirst?: boolean;
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
    <Div
      style={{
        display: "flex",
        whiteSpace: "pre-wrap",
        justifyContent: "center",
      }}
    >
      <KbShortcutSelect shortcutItems={items} onSelect={onSelect} />
    </Div>
  );
}
