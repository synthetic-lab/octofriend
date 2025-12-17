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
  const [ size, setSize ] = useState({
    width: 80,
    height: 20,
  });
  const { stdout } = useStdout();

  // Initial size measurement
  useEffect(() => {
    const width = stdout?.columns || 80;
    const height = stdout?.rows || 20;
    setSize({ width, height });
  }, []);

  // Watch for resize
  useEffect(() => {
    function handleElementSize() {
      const width = stdout?.columns || 80;
      const height = stdout?.rows || 20;
      setSize({ width, height });
    }
    function handleResize() {
      setTimeout(handleElementSize, 0);
    }
    process.stdout.on('resize', handleResize);

    return () => {
      process.stdout.off('resize', handleResize);
    };
  }, [ stdout ]);

  return <TerminalSizeContext.Provider value={size}>
    { children }
  </TerminalSizeContext.Provider>;
}
