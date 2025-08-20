import React, { useState, createContext, useContext } from "react";
import { useInput, useApp } from "ink";

export function useCtrlC(callback: () => void) {
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
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

  useCtrlC(() => {
    if (ctrlCPressed) {
      exit();
    } else {
      setCtrlCPressed(true);
      setTimeout(() => setCtrlCPressed(false), 2000);
    }
  });

  return (
    <CtrlCPressedContext.Provider value={ctrlCPressed}>
      {children}
    </CtrlCPressedContext.Provider>
  );
}