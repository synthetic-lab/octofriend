import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db/db.ts";
import { historyItems, llmIrs, treeNodes } from "./schema/session-history-schema.ts";
import {
  createSession,
  deleteHistoryNodes,
  insertHistoryItems,
  loadSession,
  type HistoryItem,
} from "./index.ts";
import { serializeModelJson } from "./model-json.ts";

/*
 * The ESC-rewind design relies on the database rejecting stale writes: when a prompt is
 * rewound its tree node is deleted, and any in-flight arc that later tries to append history
 * under the deleted node must fail (the caller catches and moves on) rather than resurrect
 * the prompt. These tests pin that the drizzle schema + SQLite actually enforce it:
 *
 * - the composite FK (parent_id, tree_id) → tree_nodes(id, tree_id) rejects inserts whose
 *   parent is deleted, nonexistent, or in another tree,
 * - enforcement is atomic: a failing multi-item insert rolls back the whole transaction,
 * - ON DELETE CASCADE removes whole subtrees (and, via triggers, their payloads),
 * - the connection stays usable after a rejected write, so "catch and move on" works.
 */

const LOCAL_CLI_ARGS = { kind: "local" } as const;
const TEST_MODEL_JSON = serializeModelJson({
  nickname: "test-model",
  model: "test-model",
  context: 128_000,
  baseUrl: "http://localhost",
});

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
    treeNodes: db().select({ id: treeNodes.id }).from(treeNodes).all().length,
  };
}

describe("tree node foreign key enforcement", () => {
  it("enables foreign key enforcement on the app connection", () => {
    // FK constraints are per-connection in SQLite; everything below depends on this pragma.
    expect(db().$client.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("rejects appending history under a deleted node, rolling back the whole batch", () => {
    const session = createSession("/test/fk-deleted-parent", LOCAL_CLI_ARGS);
    const [, b] = insertHistoryItems(
      session,
      null,
      [userMessage("A"), userMessage("B")],
      TEST_MODEL_JSON,
    );
    deleteHistoryNodes(session, [b.nodeId]);
    const afterDelete = countRows();

    // A stale in-flight arc still holds b's nodeId as its history tip and tries to append.
    expect(() =>
      insertHistoryItems(
        session,
        b.nodeId,
        [userMessage("stale 1"), userMessage("stale 2")],
        TEST_MODEL_JSON,
      ),
    ).toThrowError(/FOREIGN KEY constraint failed/i);

    // The multi-item insert is one transaction: none of it may survive the failure.
    expect(countRows()).toEqual(afterDelete);
  });

  it("rejects appending under a parent id that never existed", () => {
    const session = createSession("/test/fk-missing-parent", LOCAL_CLI_ARGS);
    insertHistoryItems(session, null, [userMessage("A")], TEST_MODEL_JSON);
    const baseline = countRows();

    expect(() =>
      insertHistoryItems(session, 999_999_999, [userMessage("B")], TEST_MODEL_JSON),
    ).toThrowError(/FOREIGN KEY constraint failed/i);
    expect(countRows()).toEqual(baseline);
  });

  it("rejects a parent node from a different session tree", () => {
    const first = createSession("/test/fk-tree-1", LOCAL_CLI_ARGS);
    const second = createSession("/test/fk-tree-2", LOCAL_CLI_ARGS);
    const [a] = insertHistoryItems(first, null, [userMessage("A")], TEST_MODEL_JSON);
    insertHistoryItems(second, null, [userMessage("root")], TEST_MODEL_JSON);
    const baseline = countRows();

    expect(() =>
      insertHistoryItems(second, a.nodeId, [userMessage("B")], TEST_MODEL_JSON),
    ).toThrowError(/FOREIGN KEY constraint failed/i);
    expect(countRows()).toEqual(baseline);
  });

  it("accepts multi-item inserts chained within one transaction", () => {
    const session = createSession("/test/fk-chain", LOCAL_CLI_ARGS);
    const nodes = insertHistoryItems(
      session,
      null,
      [userMessage("A"), userMessage("B"), userMessage("C")],
      TEST_MODEL_JSON,
    );
    expect(nodes).toHaveLength(3);
    expect(loadSession(session.metadata.sessionId!)!.history).toHaveLength(3);
  });

  it("leaves the database usable after a rejected stale append", () => {
    const session = createSession("/test/fk-recover", LOCAL_CLI_ARGS);
    const [a, b] = insertHistoryItems(
      session,
      null,
      [userMessage("A"), userMessage("B")],
      TEST_MODEL_JSON,
    );
    deleteHistoryNodes(session, [b.nodeId]);

    // The stale write is rejected; the caller catches it and moves on...
    expect(() =>
      insertHistoryItems(session, b.nodeId, [userMessage("stale")], TEST_MODEL_JSON),
    ).toThrowError(/FOREIGN KEY constraint failed/i);

    // ...and the real continuation appends under the new tip without issue.
    const [c] = insertHistoryItems(session, a.nodeId, [userMessage("C")], TEST_MODEL_JSON);
    const loaded = loadSession(session.metadata.sessionId!)!;
    expect(loaded.history.map(node => node.nodeId)).toEqual([a.nodeId, c.nodeId]);
  });

  it("cascades deletion of a whole subtree and its payloads", () => {
    const session = createSession("/test/fk-cascade", LOCAL_CLI_ARGS);
    const [a] = insertHistoryItems(
      session,
      null,
      [userMessage("A"), userMessage("B"), userMessage("C")],
      TEST_MODEL_JSON,
    );
    const baseline = countRows();

    // Deleting a node with children (raw delete, bypassing deleteHistoryNodes' leaf guard)
    // must cascade to the entire subtree; triggers then delete items and payloads.
    db().delete(treeNodes).where(eq(treeNodes.id, a.nodeId)).run();

    expect(countRows()).toEqual({
      historyItems: baseline.historyItems - 3,
      llmIrs: baseline.llmIrs - 3,
      treeNodes: baseline.treeNodes - 3,
    });
    expect(loadSession(session.metadata.sessionId!)).toBeNull();
  });

  it("allows a new root after the old root's subtree was deleted", () => {
    const session = createSession("/test/fk-new-root", LOCAL_CLI_ARGS);
    const [a] = insertHistoryItems(session, null, [userMessage("A")], TEST_MODEL_JSON);
    db().delete(treeNodes).where(eq(treeNodes.id, a.nodeId)).run();

    const [fresh] = insertHistoryItems(session, null, [userMessage("fresh")], TEST_MODEL_JSON);
    const loaded = loadSession(session.metadata.sessionId!)!;
    expect(loaded.history.map(node => node.nodeId)).toEqual([fresh.nodeId]);
  });

  it("rejects a second root node for the same tree", () => {
    const session = createSession("/test/fk-second-root", LOCAL_CLI_ARGS);
    insertHistoryItems(session, null, [userMessage("A")], TEST_MODEL_JSON);
    const baseline = countRows();

    expect(() =>
      insertHistoryItems(session, null, [userMessage("second root")], TEST_MODEL_JSON),
    ).toThrowError(/UNIQUE constraint failed/i);
    expect(countRows()).toEqual(baseline);
  });
});
