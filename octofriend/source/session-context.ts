import { createContext, useContext } from "react";
import type { Session } from "./session-history/index.ts";

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session == null) throw new Error("Session is not initialized.");
  return session;
}
