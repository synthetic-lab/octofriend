import React, { useState, createContext, useContext } from "react";
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
  useCtrlC(() => {
    if (ctrlCPressed) {
      /*
       * Record skip markers for any un-run tool calls before exiting, so the session history
       * stays well-formed (Anthropic rejects sessions with unanswered tool calls on resume).
       * If the menu is open, close it first: the in-flight state is stashed in preMenuModeData.
       */
      const state = useAppStore.getState();
      if (state.modeData.mode === "menu") state.closeMenu();
      state.abortResponse(session, config, { exiting: true });
      exit();
    } else {
      setCtrlCPressed(true);
      setTimeout(() => setCtrlCPressed(false), 2000);
    }
  });
  return (
    <CtrlCPressedContext.Provider value={ctrlCPressed}>{children}</CtrlCPressedContext.Provider>
  );
}
