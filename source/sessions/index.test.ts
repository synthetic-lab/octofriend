import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../db/db.ts";
import { sessionsTable, sessionMessagesTable } from "./schema/sessions-table.ts";
import {
  createSession,
  loadSession,
  loadSessionByMetadata,
  findLatestSession,
  listSessions,
  resolveSessionId,
  deleteSession,
  countMessages,
  SessionResumeError,
} from "./index.ts";
import { HistoryItem, sequenceId } from "../history.ts";

function userMessage(content: string): HistoryItem {
  return { type: "user", id: sequenceId(), content };
}

function assistantMessage(content: string): HistoryItem {
  return {
    type: "assistant",
    id: sequenceId(),
    content,
    tokenUsage: 0,
    outputTokens: 0,
  };
}

function notificationMessage(content: string): HistoryItem {
  return { type: "notification", id: sequenceId(), content };
}

describe("Sessions", () => {
  beforeEach(async () => {
    await db().delete(sessionMessagesTable);
    await db().delete(sessionsTable);
  });

  it("createSession does not persist until a user message is added", async () => {
    const store = createSession("/tmp/proj-lazy");
    expect(store.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(store.isPersisted()).toBe(false);

    // Notification-only history should NOT trigger persistence
    await store.persistHistory([notificationMessage("model changed")]);
    expect(store.isPersisted()).toBe(false);
    expect(resolveSessionId(store.id)).toBeNull();
    expect(countMessages(store.id)).toBe(0);

    // Adding a user message should trigger persistence
    await store.persistHistory([userMessage("hello")]);
    expect(store.isPersisted()).toBe(true);
    expect(countMessages(store.id)).toBe(1);

    const meta = resolveSessionId(store.id);
    expect(meta).not.toBeNull();
    expect(meta?.id).toBe(store.id);
  });

  it("creates a session and persists incremental history", async () => {
    const store = createSession("/tmp/proj-a");
    expect(store.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    await store.persistHistory([userMessage("hello")]);
    await store.persistHistory([userMessage("hello"), assistantMessage("hi back")]);

    expect(countMessages(store.id)).toBe(2);
  });

  it("derives a title from the first user message", async () => {
    const store = createSession("/tmp/proj-a");
    await store.persistHistory([userMessage("plan the migration")]);

    const meta = resolveSessionId(store.id);
    expect(meta?.title).toBe("plan the migration");
  });

  it("loads existing session history and continues writes", async () => {
    const original = createSession("/tmp/proj-b");
    await original.persistHistory([userMessage("first"), assistantMessage("second")]);

    const resumed = loadSession(original.id);
    expect(resumed.isPersisted()).toBe(true);
    const initial = resumed.getInitialHistory();
    expect(initial).toHaveLength(2);
    expect(initial[0]).toMatchObject({ type: "user", content: "first" });
    expect(initial[1]).toMatchObject({ type: "assistant", content: "second" });

    await resumed.persistHistory([...initial, userMessage("third")]);
    expect(countMessages(resumed.id)).toBe(3);
  });

  it("removes items that disappear from history (e.g. retry-tool replacement)", async () => {
    const store = createSession("/tmp/proj-c");
    const u = userMessage("u");
    const aFirst = assistantMessage("first attempt");
    const aSecond = assistantMessage("second attempt");

    await store.persistHistory([u, aFirst]);
    await store.persistHistory([u, aSecond]);

    expect(countMessages(store.id)).toBe(2);
    const reloaded = loadSession(store.id).getInitialHistory();
    expect(reloaded).toHaveLength(2);
    expect(reloaded[1]).toMatchObject({ content: "second attempt" });
  });

  it("findLatestSession returns the most recently updated for a cwd", async () => {
    const a = createSession("/tmp/proj-d");
    await a.persistHistory([userMessage("older")]);
    await new Promise(r => setTimeout(r, 5));
    const b = createSession("/tmp/proj-d");
    await b.persistHistory([userMessage("newer")]);

    const latest = findLatestSession("/tmp/proj-d");
    expect(latest?.id).toBe(b.id);

    expect(findLatestSession("/tmp/other")).toBeNull();
    expect(a.id).not.toBe(b.id);
  });

  it("findLatestSession does not return unpersisted sessions", () => {
    createSession("/tmp/proj-empty");
    expect(findLatestSession("/tmp/proj-empty")).toBeNull();
  });

  it("resolves session ids by unique prefix and rejects ambiguous ones", async () => {
    const id1 = "a1b2c3d4-1111-4111-8111-aaaaaaaa1111";
    const id2 = "a1b2c3d4-2222-4222-8222-bbbbbbbb2222";
    const now = Date.now();
    db()
      .insert(sessionsTable)
      .values([
        { id: id1, cwd: "/x", createdAt: now, updatedAt: now, title: null },
        { id: id2, cwd: "/x", createdAt: now, updatedAt: now, title: null },
      ])
      .run();

    expect(resolveSessionId(id1)?.id).toBe(id1);
    expect(resolveSessionId("a1b2c3d4-1")?.id).toBe(id1);
    expect(() => resolveSessionId("a1b2c3d4")).toThrow(SessionResumeError);
    expect(resolveSessionId("zzzz")).toBeNull();
  });

  it("loadSession throws SessionResumeError when missing", () => {
    expect(() => loadSession("nonexistent")).toThrow(SessionResumeError);
  });

  it("listSessions filters by cwd and orders by updatedAt desc", async () => {
    const a = createSession("/tmp/p1");
    await a.persistHistory([userMessage("a")]);
    await new Promise(r => setTimeout(r, 5));
    const b = createSession("/tmp/p1");
    await b.persistHistory([userMessage("b")]);
    // Unpersisted session should not appear
    createSession("/tmp/p2");

    const scoped = listSessions({ cwd: "/tmp/p1" });
    expect(scoped.map(s => s.id)).toEqual([b.id, a.id]);

    const all = listSessions({});
    expect(all.length).toBe(2);
  });

  it("deleteSession cascades to session messages", async () => {
    const store = createSession("/tmp/proj-e");
    await store.persistHistory([userMessage("a"), assistantMessage("b")]);
    expect(countMessages(store.id)).toBe(2);

    deleteSession(store.id);
    expect(resolveSessionId(store.id)).toBeNull();
    expect(countMessages(store.id)).toBe(0);
  });

  it("preserves bigint sequence ids on round-trip", async () => {
    const store = createSession("/tmp/proj-f");
    const item = userMessage("msg");
    await store.persistHistory([item]);

    const reloaded = loadSessionByMetadata(resolveSessionId(store.id)!).getInitialHistory();
    expect(typeof reloaded[0].id).toBe("bigint");
    expect(reloaded[0].id).toBe(item.id);
  });
});
