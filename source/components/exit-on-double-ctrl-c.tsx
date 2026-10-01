import React, { useState, createContext, useContext } from "react";
import { useAppStore } from "../state.ts";
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
  const trajectory = useAppStore(state =>
    state.sessionMode.mode === "live" ? state.sessionMode.trajectory : null,
  );
  useCtrlC(() => {
    if (ctrlCPressed) {
      if (trajectory != null) {
        trajectory.exitController.abort();
        // Exit only once the trajectory has recorded skip markers for unanswered tool calls,
        // so the session history stays well-formed on resume.
        void trajectory.runPromise.then(() => exit());
      } else {
        exit();
      }
    } else {
      setCtrlCPressed(true);
      setTimeout(() => setCtrlCPressed(false), 2000);
    }
  });
  return (
    <CtrlCPressedContext.Provider value={ctrlCPressed}>{children}</CtrlCPressedContext.Provider>
  );
}
