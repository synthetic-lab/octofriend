import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, schema } from "../db/db.ts";
import {
  createSessionContext,
  createSessionHistory,
  listSessions,
  loadSessionState,
  loadSessionPath,
  type HistoryItem,
} from "./index.ts";
import { CURRENT_LLM_IR_JSON_VERSION } from "./llm-ir-json.ts";

const llmIr = (role: "user" | "assistant", content: string): HistoryItem => ({
  type: "llm-ir",
  ir:
    role === "user"
      ? { role, content: [{ type: "text", content }] }
      : {
          role,
          content,
          usage: {
            input: { cached: 0, uncached: 1, total: 1 },
            output: 1,
          },
        },
});

describe("session history", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    db().delete(schema.treeNodes).run();
    db().delete(schema.historyItems).run();
    db().delete(schema.requestFailedItems).run();
    db().delete(schema.compactionFailedItems).run();
    db().delete(schema.notifications).run();
    db().delete(schema.llmIrs).run();
    db().delete(schema.trees).run();
    db().delete(schema.launches).run();
    db().delete(schema.dockerLaunches).run();
    db().delete(schema.localLaunches).run();
  });

  it("round-trips a tree path via append and loadSessionState", async () => {
    const session = createSessionContext("/repo");
    const history: HistoryItem[] = [
      llmIr("user", "hello"),
      { type: "notification", content: "Model: test" },
      llmIr("assistant", "hi"),
      { type: "compaction-failed" },
    ];

    const manager = createSessionHistory(session);
    await manager.append(history);
    await manager.flush();

    const state = await loadSessionState(session.id);
    expect(state).toMatchObject({
      id: session.id,
      cwd: "/repo",
      transportKind: "local",
      cliArgs: { kind: "local" },
      history,
    });
    const path = await loadSessionPath(session.id);
    if (path == null) throw new Error("Expected session path");
    expect(path.nodePath).toHaveLength(history.length);
    const parentIds = path.nodePath.map(node => node.parentId);
    const nodeIds = path.nodePath.map(node => node.nodeId);
    expect(parentIds).toEqual([null, nodeIds[0], nodeIds[1], nodeIds[2]]);
  });

  it("does not persist trees with no LLM messages", async () => {
    const session = createSessionContext("/repo");
    const manager = createSessionHistory(session);

    expect(await manager.append([])).toBe(false);
    expect(await manager.append([{ type: "notification", content: "note" }])).toBe(false);
    expect(await loadSessionState(session.id)).toBeNull();
    expect(db().select().from(schema.trees).all()).toHaveLength(0);
  });

  it("stores each history item variant in its own payload table", async () => {
    const session = createSessionContext("/repo");
    const manager = createSessionHistory(session);
    await manager.append([
      llmIr("user", "hello"),
      { type: "notification", content: "note" },
      { type: "request-failed" },
      { type: "compaction-failed" },
    ]);
    await manager.flush();

    const llmRows = db().select().from(schema.llmIrs).all();
    const requestFailedRows = db().select().from(schema.requestFailedItems).all();
    const compactionFailedRows = db().select().from(schema.compactionFailedItems).all();
    const notificationRows = db().select().from(schema.notifications).all();
    const itemRows = db().select().from(schema.historyItems).all();

    expect(JSON.parse(llmRows[0].json).version).toBe(CURRENT_LLM_IR_JSON_VERSION);
    expect(requestFailedRows).toHaveLength(1);
    expect(compactionFailedRows).toHaveLength(1);
    expect(notificationRows).toMatchObject([{ content: "note" }]);
    expect(itemRows).toHaveLength(4);
    expect(
      itemRows.every(
        row =>
          [row.requestFailedId, row.compactionFailedId, row.notificationId, row.llmIrId].filter(
            id => id != null,
          ).length === 1,
      ),
    ).toBe(true);
  });

  it("requires each history item to reference exactly one variant table", () => {
    const requestFailedId = db()
      .insert(schema.requestFailedItems)
      .values({})
      .returning({ id: schema.requestFailedItems.id })
      .get().id;
    const compactionFailedId = db()
      .insert(schema.compactionFailedItems)
      .values({})
      .returning({ id: schema.compactionFailedItems.id })
      .get().id;

    expect(() => db().insert(schema.historyItems).values({}).run()).toThrow();
    expect(() =>
      db().insert(schema.historyItems).values({ requestFailedId, compactionFailedId }).run(),
    ).toThrow();
  });

  it("branches edit-retry history without deleting the previous path", async () => {
    const session = createSessionContext("/repo");
    const manager = createSessionHistory(session);
    const original = [llmIr("user", "first"), llmIr("assistant", "resp"), llmIr("user", "retry")];
    await manager.append(original);

    const prefix = original.slice(0, 2);
    expect(await manager.replace(prefix)).toBe(true);
    const edited = [...prefix, llmIr("user", "edited retry")];
    expect(await manager.append(edited)).toBe(true);
    await manager.flush();

    expect((await loadSessionState(session.id))?.history).toEqual(edited);
    expect(db().select().from(schema.treeNodes).all()).toHaveLength(4);
    expect(
      db().select().from(schema.treeNodes).where(eq(schema.treeNodes.isLeaf, true)).all(),
    ).toHaveLength(2);
  });

  it("keeps persisted history when an edit moves the cursor to an empty prefix", async () => {
    const session = createSessionContext("/repo");
    const manager = createSessionHistory(session);
    const history = [llmIr("user", "hello")];
    await manager.append(history);

    expect(await manager.replace([])).toBe(false);
    expect((await loadSessionState(session.id))?.history).toEqual(history);
    expect(db().select().from(schema.treeNodes).all()).toHaveLength(1);
  });

  it("serializes queued operations within one manager", async () => {
    const session = createSessionContext("/repo");
    const manager = createSessionHistory(session);
    const original = [llmIr("user", "first"), llmIr("assistant", "resp"), llmIr("user", "retry")];
    const prefix = original.slice(0, 2);
    const continued = [...prefix, llmIr("user", "edited retry")];

    const p1 = manager.append(original);
    const p2 = manager.replace(prefix);
    const p3 = manager.append(continued);

    expect(await p1).toBe(true);
    expect(await p2).toBe(true);
    expect(await p3).toBe(true);
    expect((await loadSessionState(session.id))?.history).toEqual(continued);
  });

  it("allows concurrent resumes to create sibling branches", async () => {
    const session = createSessionContext("/repo");
    const initial = [llmIr("user", "root")];
    const initialManager = createSessionHistory(session);
    await initialManager.append(initial);
    await initialManager.flush();

    const persisted = await loadSessionState(session.id);
    if (persisted == null) throw new Error("Expected persisted session");
    const persistedPath = await loadSessionPath(session.id);
    const firstManager = createSessionHistory(
      persisted,
      persisted.history,
      persistedPath ?? undefined,
    );
    const secondManager = createSessionHistory(
      persisted,
      persisted.history,
      persistedPath ?? undefined,
    );
    const firstBranch = [...initial, llmIr("assistant", "first")];
    const secondBranch = [...initial, llmIr("assistant", "second")];

    expect(
      await Promise.all([firstManager.append(firstBranch), secondManager.append(secondBranch)]),
    ).toEqual([true, true]);
    await Promise.all([firstManager.flush(), secondManager.flush()]);

    const nodes = db().select().from(schema.treeNodes).all();
    const leaves = nodes.filter(node => node.isLeaf);
    expect(nodes).toHaveLength(3);
    expect(leaves).toHaveLength(2);
    expect(new Set(leaves.map(node => node.parentId))).toEqual(new Set([nodes[0].id]));
    expect((await loadSessionState(session.id))?.history).toEqual(secondBranch);
  });

  it("allows only one root node per tree", async () => {
    const session = createSessionContext("/repo");
    const firstManager = createSessionHistory({ ...session });
    const secondManager = createSessionHistory({ ...session });

    expect(await firstManager.append([llmIr("user", "first root")])).toBe(true);
    expect(await secondManager.append([llmIr("user", "second root")])).toBe(false);

    const nodes = db().select().from(schema.treeNodes).all();
    expect(nodes).toHaveLength(1);
    expect(nodes[0].parentId).toBeNull();
  });

  it("protects parent nodes and referenced payloads from deletion", async () => {
    const session = createSessionContext("/repo");
    const manager = createSessionHistory(session);
    await manager.append([llmIr("user", "root"), llmIr("assistant", "child")]);
    await manager.flush();

    const nodes = db().select().from(schema.treeNodes).all();
    const llmRows = db().select().from(schema.llmIrs).all();
    expect(() =>
      db().delete(schema.treeNodes).where(eq(schema.treeNodes.id, nodes[0].id)).run(),
    ).toThrow();
    expect(() =>
      db().delete(schema.llmIrs).where(eq(schema.llmIrs.id, llmRows[0].id)).run(),
    ).toThrow();
  });

  it("round-trips local and Docker launch arguments", async () => {
    const local = createSessionContext("/repo", "local", {
      kind: "local",
      config: "./local.json5",
      unchained: true,
    });
    const docker = createSessionContext("/repo", "docker", {
      kind: "docker-run",
      dockerRunArgs: ["--rm", "alpine"],
      config: "./docker.json5",
    });

    await createSessionHistory(local).append([llmIr("user", "local")]);
    await createSessionHistory(docker).append([llmIr("user", "docker")]);

    expect((await loadSessionState(local.id))?.cliArgs).toEqual(local.cliArgs);
    expect((await loadSessionState(docker.id))?.cliArgs).toEqual(docker.cliArgs);
    expect(db().select().from(schema.localLaunches).all()).toHaveLength(1);
    expect(db().select().from(schema.dockerLaunches).all()).toHaveLength(1);
    expect(db().select().from(schema.launches).all()).toHaveLength(2);
  });

  it("switchSession saves the old tree and starts a new tree in the same launch", async () => {
    const first = createSessionContext("/repo");
    const second = createSessionContext("/repo");
    const manager = createSessionHistory(first);

    await manager.append([llmIr("user", "a")]);
    manager.switchSession(second, [llmIr("user", "a"), llmIr("assistant", "b")]);
    await manager.append([llmIr("user", "c")]);
    await manager.flush();

    expect((await loadSessionState(first.id))?.history).toEqual([
      llmIr("user", "a"),
      llmIr("assistant", "b"),
    ]);
    expect((await loadSessionState(second.id))?.history).toEqual([llmIr("user", "c")]);
    expect(db().select().from(schema.launches).all()).toHaveLength(1);
  });

  it("keeps queued saves attached to the session that was active when requested", async () => {
    const first = createSessionContext("/repo");
    const second = createSessionContext("/repo");
    const manager = createSessionHistory(first);

    const firstPrefix = [llmIr("user", "a")];
    const firstSave = manager.append(firstPrefix);
    manager.switchSession(second, [...firstPrefix, llmIr("assistant", "b")]);
    const secondSave = manager.append([llmIr("user", "c")]);
    await Promise.all([firstSave, secondSave]);
    await manager.flush();

    expect((await loadSessionState(first.id))?.history).toEqual([
      llmIr("user", "a"),
      llmIr("assistant", "b"),
    ]);
    expect((await loadSessionState(second.id))?.history).toEqual([llmIr("user", "c")]);
  });

  it("listSessions orders trees by their most recent persisted update", async () => {
    const now = vi.spyOn(Date, "now");
    const a = createSessionContext("/repo");
    const b = createSessionContext("/other");
    const managerA = createSessionHistory(a);
    const managerB = createSessionHistory(b);

    now.mockReturnValue(1_000);
    await managerA.append([llmIr("user", "a")]);
    now.mockReturnValue(2_000);
    await managerB.append([llmIr("user", "b")]);

    expect(await listSessions()).toEqual([
      { id: b.id, cwd: "/other", updatedAt: 2_000 },
      { id: a.id, cwd: "/repo", updatedAt: 1_000 },
    ]);

    now.mockReturnValue(3_000);
    await managerA.append([llmIr("user", "a"), llmIr("assistant", "continued")]);

    expect(await listSessions()).toEqual([
      { id: a.id, cwd: "/repo", updatedAt: 3_000 },
      { id: b.id, cwd: "/other", updatedAt: 2_000 },
    ]);
    expect(await listSessions("/repo")).toEqual([{ id: a.id, cwd: "/repo", updatedAt: 3_000 }]);
  });
});
