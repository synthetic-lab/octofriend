import React, { createContext, useContext } from "react";

const InputFocusContext = createContext(true);

export function useInputFocus(focus = true): boolean {
  const parentFocus = useContext(InputFocusContext);
  return parentFocus && focus;
}

export function InputFocusProvider({
  focus,
  children,
}: {
  focus: boolean;
  children: React.ReactNode;
}) {
  const isFocused = useInputFocus(focus);
  return <InputFocusContext.Provider value={isFocused}>{children}</InputFocusContext.Provider>;
}
