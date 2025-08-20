import React, { useState } from "react";
import { useInput, useApp } from "ink";

export function useCtrlC(callback: () => void) {
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      callback();
    }
  });
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

  return <>{children}</>;
}