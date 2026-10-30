import React from "react";
import { KbShortcutPanel } from "./kb-select/kb-shortcut-panel.tsx";
import { Modal } from "./modal.tsx";
import { TerminalFlex } from "./terminal-flex.tsx";

export function MessageActions({ onEdit, onClose }: { onEdit: () => void; onClose: () => void }) {
  return (
    <Modal minWidth={50} onClose={onClose}>
      <TerminalFlex autoFocus style={{ flexDirection: "column" }}>
        <KbShortcutPanel
          header="Message Actions"
          shortcutItems={[
            {
              type: "key",
              mapping: {
                e: { label: "Rewind & edit", value: "edit" },
                b: { label: "Back", value: "back" },
              },
            },
          ]}
          onSelect={item => {
            if (item.value === "edit") onEdit();
            else if (item.value === "back") onClose();
          }}
        />
      </TerminalFlex>
    </Modal>
  );
}
