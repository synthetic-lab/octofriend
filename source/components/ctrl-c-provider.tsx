import React, { useState, useRef, createContext, useContext, useEffect } from "react";
import { useInput, useApp } from "ink";

type CtrlCContextType = {
  ctrlCPressed: boolean;
  registerClearInputFn: (clearFn: () => void) => void;
};

const CtrlCContext = createContext<CtrlCContextType>({
  ctrlCPressed: false,
  registerClearInputFn: () => {},
});

export function useCtrlC() {
  return useContext(CtrlCContext);
}

type CtrlCProviderProps = {
  children: React.ReactNode;
};

export function CtrlCProvider({ children }: CtrlCProviderProps) {
  const [ctrlCPressed, setCtrlCPressed] = useState(false);
  const clearInputRef = useRef<(() => void) | null>(null);
  const { exit } = useApp();

  // Global input handler to capture Ctrl+C
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (ctrlCPressed) {
        exit();
      } else {
        if (clearInputRef.current) {
          clearInputRef.current();
        }
        setCtrlCPressed(true);
        setTimeout(() => setCtrlCPressed(false), 2000);
      }
    }
  });

  const registerClearInputFn = (clearFn: () => void) => {
    clearInputRef.current = clearFn;
  };

  return (
    <CtrlCContext.Provider value={{
      ctrlCPressed,
      registerClearInputFn,
    }}>
      {children}
    </CtrlCContext.Provider>
  );
}