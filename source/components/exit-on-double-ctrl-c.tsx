import React, { useState, createContext, useContext } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../state.ts";
import { useConfig } from "../config.ts";
import { useSession } from "../session-context.ts";
import { useApp } from "paintcannon-react";
import { useKeyboard } from "../hooks/use-keyboard.ts";
export function useCtrlC(callback: () => void) {
  useKeyboard(event => {
    if (!event.defaultPrevented && event.ctrlKey && event.key === "c") {
      callback();
    }
  });
}
const CtrlCPressedContext = createContext(false);
export function useCtrlCPressed() {
  return useContext(CtrlCPressedContext);
}
export function ExitOnDoubleCtrlC({ children }: { children: React.ReactNode }) {
  const [ctrlCPressed, setCtrlCPressed] = useState(false);
  const { exit } = useApp();
  const config = useConfig();
  const session = useSession();
  const vimEnabled = !!config.vimEmulation?.enabled;
  const { modeData } = useAppStore(
    useShallow(state => ({
      modeData: state.modeData,
    })),
  );
  const isInsertMode = vimEnabled && modeData.mode === "input" && modeData.vimMode === "INSERT";
  useCtrlC(() => {
    if (ctrlCPressed) {
      /*
       * Record skip markers for any un-run tool calls before exiting, so the session history
       * stays well-formed (Anthropic rejects sessions with unanswered tool calls on resume).
       * If the menu is open, close it first: the in-flight state is stashed in preMenuModeData.
       */
      const state = useAppStore.getState();
      if (state.modeData.mode === "menu") state.closeMenu();
      state.abortResponse(session, { exiting: true });
      exit();
    } else {
      if (!isInsertMode) {
        setCtrlCPressed(true);
        setTimeout(() => setCtrlCPressed(false), 2000);
      }
    }
  });
  return (
    <CtrlCPressedContext.Provider value={ctrlCPressed}>{children}</CtrlCPressedContext.Provider>
  );
}
