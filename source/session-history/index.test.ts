import { describe, expect, it } from "vitest";
import { db } from "../db/db.ts";
import { historyItems, llmIrs, notifications } from "./schema/session-history-schema.ts";
import {
  createSession,
  deleteSession,
  insertHistoryItems,
  loadSession,
  SessionNotFoundError,
  type HistoryItem,
} from "./index.ts";

const LOCAL_CLI_ARGS = { kind: "local" } as const;

function userMessage(content: string): HistoryItem {
  return {
    type: "llm-ir",
    ir: {
      role: "user",
      content: [{ type: "text", content }],
    },
  };
}

function countRows() {
  return {
    historyItems: db().select({ id: historyItems.id }).from(historyItems).all().length,
    llmIrs: db().select({ id: llmIrs.id }).from(llmIrs).all().length,
    notifications: db().select({ id: notifications.id }).from(notifications).all().length,
  };
}

describe("deleteSession", () => {
  it("deletes an existing session", () => {
    const session = createSession("/test/delete-session", LOCAL_CLI_ARGS);
    insertHistoryItems(session, null, [userMessage("Delete me")]);
    const sessionId = session.metadata.sessionId;
    expect(sessionId).not.toBeNull();

    expect(deleteSession(sessionId!)).toBe(true);
    expect(loadSession(sessionId!)).toBeNull();
    expect(deleteSession(sessionId!)).toBe(false);
  });

  it("reports a deleted session before inserting more history", () => {
    const session = createSession("/test/stale-session", LOCAL_CLI_ARGS);
    const history = insertHistoryItems(session, null, [userMessage("Initial message")]);
    const sessionId = session.metadata.sessionId;
    expect(sessionId).not.toBeNull();
    expect(deleteSession(sessionId!)).toBe(true);

    let thrown: unknown;
    try {
      insertHistoryItems(session, history.at(-1)!.nodeId, [userMessage("Late message")]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SessionNotFoundError);
    expect(thrown).toMatchObject({
      sessionId,
      message: `Session ${sessionId} does not exist.`,
    });
  });

  it("removes the session's history items and their payload rows", () => {
    const session = createSession("/test/delete-payloads", LOCAL_CLI_ARGS);
    const baseline = countRows();

    insertHistoryItems(session, null, [
      userMessage("Garbage collect me"),
      { type: "notification", content: "and me" },
    ]);
    expect(countRows()).toEqual({
      historyItems: baseline.historyItems + 2,
      llmIrs: baseline.llmIrs + 1,
      notifications: baseline.notifications + 1,
    });

    expect(deleteSession(session.metadata.sessionId!)).toBe(true);
    expect(countRows()).toEqual(baseline);
  });

  it("leaves other sessions' history rows intact", () => {
    const keep = createSession("/test/keep-session", LOCAL_CLI_ARGS);
    insertHistoryItems(keep, null, [userMessage("Keep me")]);
    const drop = createSession("/test/drop-session", LOCAL_CLI_ARGS);
    insertHistoryItems(drop, null, [userMessage("Drop me")]);

    expect(deleteSession(drop.metadata.sessionId!)).toBe(true);

    expect(loadSession(keep.metadata.sessionId!)).not.toBeNull();
    const remaining = db()
      .select({ json: llmIrs.json })
      .from(llmIrs)
      .all()
      .map(row => row.json);
    expect(remaining.some(json => json.includes("Keep me"))).toBe(true);
    expect(remaining.some(json => json.includes("Drop me"))).toBe(false);
  });
});
