import { createContext, useContext } from "react";

export const DEFAULT_CWD_CONTEXT_VALUE = "\0";

export const CwdContext = createContext<string>(DEFAULT_CWD_CONTEXT_VALUE);

export function useCwd(): string {
	return useContext(CwdContext);
}
