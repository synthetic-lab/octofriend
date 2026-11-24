import type { SessionSummary } from "./index.ts";
import { formatTimeAgo } from "../time.ts";

export const SESSION_ID_HEADER = "SESSION ID";
export const SESSION_PREVIEW_HEADER = "PREVIEW";
export const SESSION_UPDATED_HEADER = "LAST UPDATED";

export type SessionListRow = SessionSummary & {
  updatedAtText: string;
};

export type SessionListTable = {
  rows: SessionListRow[];
  sessionIdWidth: number;
  previewWidth: number;
};

export function sessionListTable(
  sessions: SessionSummary[],
  now: Date = new Date(),
): SessionListTable {
  const rows = sessions.map(session => ({
    ...session,
    updatedAtText: formatTimeAgo(new Date(session.updatedAt), now),
  }));
  return {
    rows,
    sessionIdWidth: Math.max(SESSION_ID_HEADER.length, ...rows.map(row => row.sessionId.length)),
    previewWidth: Math.max(
      SESSION_PREVIEW_HEADER.length,
      ...rows.map(row => (row.preview ?? "").length),
    ),
  };
}
