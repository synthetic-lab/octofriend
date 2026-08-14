import { describe, expect, it } from "bun:test";
import { db } from "../db/db.ts";
import { historyItems, llmIrs, notifications } from "./schema/session-history-schema.ts";
import {
  createSession,
  deleteSession,
  insertHistoryItems,
  latestModelJson,
  loadSession,
  SessionNotFoundError,
  type HistoryItem,
} from "./index.ts";
import { NO_MODEL_RECORDED, serializeModelJson } from "./model-json.ts";
import type { ModelConfig } from "../config.ts";

const LOCAL_CLI_ARGS = { kind: "local" } as const;

function testModel(nickname: string): ModelConfig {
  return {
    nickname,
    model: nickname,
    context: 128_000,
    baseUrl: "http://localhost",
  };
}

const TEST_MODEL_JSON = serializeModelJson(testModel("test-model"));

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
    insertHistoryItems(session, null, [userMessage("Delete me")], TEST_MODEL_JSON);
    const sessionId = session.metadata.sessionId;
    expect(sessionId).not.toBeNull();

    expect(deleteSession(sessionId!)).toBe(true);
    expect(loadSession(sessionId!)).toBeNull();
    expect(deleteSession(sessionId!)).toBe(false);
  });

  it("reports a deleted session before inserting more history", () => {
    const session = createSession("/test/stale-session", LOCAL_CLI_ARGS);
    const history = insertHistoryItems(
      session,
      null,
      [userMessage("Initial message")],
      TEST_MODEL_JSON,
    );
    const sessionId = session.metadata.sessionId;
    expect(sessionId).not.toBeNull();
    expect(deleteSession(sessionId!)).toBe(true);

    let thrown: unknown;
    try {
      insertHistoryItems(
        session,
        history.at(-1)!.nodeId,
        [userMessage("Late message")],
        TEST_MODEL_JSON,
      );
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

    insertHistoryItems(
      session,
      null,
      [userMessage("Garbage collect me"), { type: "notification", content: "and me" }],
      TEST_MODEL_JSON,
    );
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
    insertHistoryItems(keep, null, [userMessage("Keep me")], TEST_MODEL_JSON);
    const drop = createSession("/test/drop-session", LOCAL_CLI_ARGS);
    insertHistoryItems(drop, null, [userMessage("Drop me")], TEST_MODEL_JSON);

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

describe("model identifiers", () => {
  it("persists the serialized model on history nodes", () => {
    const session = createSession("/test/model-json", LOCAL_CLI_ARGS);
    const smartModelJson = serializeModelJson(testModel("smart-model"));
    insertHistoryItems(session, null, [userMessage("Hello")], smartModelJson);
    const sessionId = session.metadata.sessionId!;

    const loaded = loadSession(sessionId);
    expect(loaded).not.toBeNull();
    expect(loaded!.history.map(node => node.modelJson)).toEqual([smartModelJson]);
    expect(latestModelJson(loaded!.history)).toBe(smartModelJson);
  });

  it("resumes with the most recently persisted model", () => {
    const session = createSession("/test/model-switch", LOCAL_CLI_ARGS);
    const smartModelJson = serializeModelJson(testModel("smart-model"));
    const fastModelJson = serializeModelJson(testModel("fast-model"));
    const first = insertHistoryItems(session, null, [userMessage("Hello")], smartModelJson);
    insertHistoryItems(session, first.at(-1)!.nodeId, [userMessage("Switch")], fastModelJson);
    const sessionId = session.metadata.sessionId!;

    const loaded = loadSession(sessionId)!;
    expect(loaded.history.map(node => node.modelJson)).toEqual([smartModelJson, fastModelJson]);
    expect(latestModelJson(loaded.history)).toBe(fastModelJson);
  });

  it("treats the legacy sentinel as no recorded model", () => {
    const session = createSession("/test/model-legacy", LOCAL_CLI_ARGS);
    insertHistoryItems(session, null, [userMessage("Hello")], NO_MODEL_RECORDED);
    const sessionId = session.metadata.sessionId!;

    const loaded = loadSession(sessionId)!;
    expect(loaded.history.map(node => node.modelJson)).toEqual([null]);
    expect(latestModelJson(loaded.history)).toBeNull();
  });
});
