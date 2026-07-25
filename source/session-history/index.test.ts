import { describe, expect, it } from "vitest";
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
});
