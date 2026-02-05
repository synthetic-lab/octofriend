import { createContext, useContext } from "react";

export const CwdContext = createContext<string>(process.cwd());

export function useCwd(): string {
  return useContext(CwdContext);
}
