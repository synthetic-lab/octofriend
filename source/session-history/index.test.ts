import { describe, expect, it } from "vitest";
import { db } from "../db/db.ts";
import { historyItems, llmIrs, notifications } from "./schema/session-history-schema.ts";
import {
  createSession,
  deleteHistorySubtree,
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

describe("deleteHistorySubtree", () => {
  it("lets a new root be inserted after deleting the entire history (edit & retry)", () => {
    const session = createSession("/test/delete-subtree-root", LOCAL_CLI_ARGS);
    const [root] = insertHistoryItems(
      session,
      null,
      [userMessage("Original first message")],
      TEST_MODEL_JSON,
    );
    insertHistoryItems(session, root.nodeId, [userMessage("Follow-up")], TEST_MODEL_JSON);

    // Edit & retry from the first message truncates the whole in-memory history; the discarded
    // branch must be deleted from the DB, or resending tries to create a second root node and
    // violates tree_nodes_one_root_unique.
    deleteHistorySubtree(session, root.nodeId);

    const sessionId = session.metadata.sessionId!;
    const [newRoot] = insertHistoryItems(
      session,
      null,
      [userMessage("Edited first message")],
      TEST_MODEL_JSON,
    );
    expect(newRoot.nodeId).not.toBe(root.nodeId);

    const loaded = loadSession(sessionId);
    expect(loaded).not.toBeNull();
    expect(loaded!.history).toHaveLength(1);
    expect(loaded!.history[0]).toMatchObject({
      type: "llm-ir",
      ir: { role: "user", content: [{ type: "text", content: "Edited first message" }] },
    });
  });

  it("deletes descendants so the discarded branch can't resurrect on reload", () => {
    const session = createSession("/test/delete-subtree-branch", LOCAL_CLI_ARGS);
    const [root] = insertHistoryItems(session, null, [userMessage("Keep me")], TEST_MODEL_JSON);
    const [discarded] = insertHistoryItems(
      session,
      root.nodeId,
      [userMessage("Discard me")],
      TEST_MODEL_JSON,
    );
    insertHistoryItems(session, discarded.nodeId, [userMessage("Discard me too")], TEST_MODEL_JSON);

    deleteHistorySubtree(session, discarded.nodeId);

    const sessionId = session.metadata.sessionId!;
    insertHistoryItems(session, root.nodeId, [userMessage("Replacement branch")], TEST_MODEL_JSON);

    const loaded = loadSession(sessionId);
    expect(loaded).not.toBeNull();
    const messages = loaded!.history.map(item => {
      if (item.type !== "llm-ir" || item.ir.role !== "user") return null;
      return item.ir.content.find(content => content.type === "text")?.content ?? null;
    });
    expect(messages).toEqual(["Keep me", "Replacement branch"]);
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
