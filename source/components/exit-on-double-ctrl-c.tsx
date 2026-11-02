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
  useCtrlC(async () => {
    if (ctrlCPressed) {
      if (trajectory != null) {
        trajectory.exitController.abort();
        await trajectory.finished;
      }
      exit();
    } else {
      setCtrlCPressed(true);
      setTimeout(() => setCtrlCPressed(false), 2000).unref();
    }
  });
  return (
    <CtrlCPressedContext.Provider value={ctrlCPressed}>{children}</CtrlCPressedContext.Provider>
  );
}
