import { describe, it, expect, beforeEach } from "vitest";
import { db, schema } from "../db/db.ts";
import type { HistoryItem } from "../history.ts";
import {
  createSessionSaveManager,
  createSessionContext,
  loadSessionState,
  listSessions,
} from "./index.ts";
import { CURRENT_LLM_IR_JSON_VERSION } from "./llm-ir-json.ts";

const llmIr = (role: "user" | "assistant", content: string): HistoryItem => ({
  type: "llm-ir",
  ir:
    role === "user"
      ? { role, content: [{ type: "text", content }] }
      : { role, content, tokenUsage: 1, outputTokens: 1 },
});

describe("session history", () => {
  beforeEach(async () => {
    await db().delete(schema.historyItems);
    await db().delete(schema.historySessions);
  });

  it("round-trips history via append and loadSessionState", async () => {
    const session = createSessionContext("/repo");
    const history: HistoryItem[] = [
      llmIr("user", "hello"),
      { type: "notification", content: "Model: test" },
      llmIr("assistant", "hi"),
      { type: "compaction-failed" },
    ];

    const coordinator = createSessionSaveManager(session);
    await coordinator.append(history);
    await coordinator.flush();

    expect(await loadSessionState(session.id)).toEqual({
      id: session.id,
      cwd: "/repo",
      transportKind: "local",
      cliArgs: { kind: "local" },
      history,
    });
  });

  it("does not persist sessions with no LLM messages", async () => {
    const session = createSessionContext("/repo");
    const coordinator = createSessionSaveManager(session);

    expect(await coordinator.append([])).toBe(false);
    expect(await coordinator.append([{ type: "notification", content: "note" }])).toBe(false);
    expect(await loadSessionState(session.id)).toBeNull();
  });

  it("stores LLM IR in a versioned JSON envelope", async () => {
    const session = createSessionContext("/repo");
    const coordinator = createSessionSaveManager(session);
    await coordinator.append([llmIr("user", "hello")]);
    await coordinator.flush();

    const rows = await db().select().from(schema.historyItems);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].llmIrJson ?? "").version).toBe(CURRENT_LLM_IR_JSON_VERSION);
  });

  it("replaces history in-place (edit-retry)", async () => {
    const session = createSessionContext("/repo");
    const coordinator = createSessionSaveManager(session);
    await coordinator.append([
      llmIr("user", "first"),
      llmIr("assistant", "resp"),
      llmIr("user", "retry"),
    ]);

    const edited = [llmIr("user", "first"), llmIr("assistant", "resp")];
    expect(await coordinator.replace(edited)).toBe(true);

    const state = await loadSessionState(session.id);
    expect(state?.id).toBe(session.id);
    expect(state?.history).toEqual(edited);
  });

  it("deletes session on replace with empty history", async () => {
    const session = createSessionContext("/repo");
    const coordinator = createSessionSaveManager(session);
    await coordinator.append([llmIr("user", "hello")]);

    expect(await coordinator.replace([])).toBe(false);
    expect(await loadSessionState(session.id)).toBeNull();
  });

  it("serializes queued operations (append then replace then append)", async () => {
    const session = createSessionContext("/repo");
    const coordinator = createSessionSaveManager(session);
    const original = [llmIr("user", "first"), llmIr("assistant", "resp"), llmIr("user", "retry")];
    const edited = [llmIr("user", "first"), llmIr("assistant", "resp")];
    const continued = [...edited, llmIr("user", "edited retry")];

    const p1 = coordinator.append(original);
    const p2 = coordinator.replace(edited);
    const p3 = coordinator.append(continued);

    expect(await p1).toBe(true);
    expect(await p2).toBe(true);
    expect(await p3).toBe(true);

    expect(await loadSessionState(session.id)).toMatchObject({ history: continued });
  });

  it("switchSession saves old session and starts new one", async () => {
    const first = createSessionContext("/repo");
    const second = createSessionContext("/repo");
    const coordinator = createSessionSaveManager(first);

    await coordinator.append([llmIr("user", "a")]);
    coordinator.switchSession(second, [llmIr("user", "a"), llmIr("assistant", "b")]);
    await coordinator.append([llmIr("user", "c")]);
    await coordinator.flush();

    expect((await loadSessionState(first.id))?.history).toEqual([
      llmIr("user", "a"),
      llmIr("assistant", "b"),
    ]);
    expect((await loadSessionState(second.id))?.history).toEqual([llmIr("user", "c")]);
  });

  it("listSessions filters by cwd", async () => {
    const a = createSessionContext("/repo");
    const b = createSessionContext("/other");
    const coordA = createSessionSaveManager(a);
    const coordB = createSessionSaveManager(b);
    await coordA.append([llmIr("user", "a")]);
    await coordB.append([llmIr("user", "b")]);
    await Promise.all([coordA.flush(), coordB.flush()]);

    expect((await listSessions("/repo")).map(s => s.id)).toEqual([a.id]);
    expect((await listSessions()).map(s => s.id)).toEqual([b.id, a.id]);
  });
});
