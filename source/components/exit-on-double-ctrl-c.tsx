import React, { useState, createContext, useContext } from "react";
import { useShallow } from "zustand/react/shallow";
import { useInput, useApp } from "ink";
import { useAppStore } from "../state.ts";
import { useConfig } from "../config.ts";

export function useCtrlC(callback: () => void) {
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
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
  const vimEnabled = !!config.vimEmulation?.enabled;
  const { modeData } = useAppStore(
    useShallow(state => ({
      modeData: state.modeData,
    })),
  );

  const isInsertMode = vimEnabled && modeData.mode === "input" && modeData.vimMode === "INSERT";

  useCtrlC(() => {
    if (ctrlCPressed) {
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
