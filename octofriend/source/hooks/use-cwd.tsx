import { createContext, useContext } from "react";

const nullByte = "\0";
export const CwdContext = createContext<string>(nullByte);

export function useCwd(): string {
  return useContext(CwdContext);
}
