import React, { useState, createContext, useContext, useEffect } from "react";
import { useStdout } from "ink";

const TerminalSizeContext = createContext({
  width: 80,
  height: 20,
});

export function useTerminalSize() {
  return useContext(TerminalSizeContext);
}

export function TerminalSizeTracker({ children }: { children?: React.ReactNode }) {
  const [size, setSize] = useState(() => {
    const width = process.stdout.columns || 80;
    const height = process.stdout.rows || 20;
    return { width, height };
  });
  const { stdout } = useStdout();

  useEffect(() => {
    const output = stdout ?? process.stdout;
    const width = output.columns || 80;
    const height = output.rows || 20;
    setSize({ width, height });
  }, [stdout]);

  useEffect(() => {
    function handleResize() {
      const output = stdout ?? process.stdout;
      const width = output.columns || 80;
      const height = output.rows || 20;
      setSize({ width, height });
    }
    const output = stdout ?? process.stdout;
    output.on("resize", handleResize);

    return () => {
      output.off("resize", handleResize);
    };
  }, [stdout]);

  return <TerminalSizeContext.Provider value={size}>{children}</TerminalSizeContext.Provider>;
}
