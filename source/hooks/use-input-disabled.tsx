import React, { createContext, useContext } from "react";

const InputDisabledContext = createContext(false);

export function useInputDisabled(): boolean {
  return useContext(InputDisabledContext);
}

export function InputDisabledProvider({
  disabled,
  children,
}: {
  disabled: boolean;
  children: React.ReactNode;
}) {
  const parentDisabled = useInputDisabled();
  const isDisabled = parentDisabled || disabled;
  return (
    <InputDisabledContext.Provider value={isDisabled}>{children}</InputDisabledContext.Provider>
  );
}
