import { randomUUID } from "crypto";
import { and, desc, eq, type ExtractTablesWithRelations } from "drizzle-orm";
import { type BetterSQLiteTransaction } from "drizzle-orm/better-sqlite3";
import { db, schema } from "../db/db.ts";
import type { TransportKind } from "../transports/transport-common.ts";
import type { ParsedCliArgs } from "./cli-args.ts";
import { deserializeLlmIr, LlmIr, serializeLlmIr } from "./llm-ir-json.ts";
import {
  CompactionFailedRow,
  HistoryItemRow,
  NotificationRow,
  RequestFailedRow,
} from "./schema/session-history-schema.ts";

export type HistoryItem = RequestFailedRow | CompactionFailedRow | NotificationRow | LlmIr;

export type SessionNode = {
  nodeId: number;
  parentId: number | null;
  historyItem: HistoryItem;
};

export type SessionPath = {
  treeId: number;
  nodePath: SessionNode[];
};

export type SessionMetadata = {
  id: string;
  cwd: string;
  transportKind: TransportKind;
};

export type SessionContext = SessionMetadata & {
  cliArgs: ParsedCliArgs;
};

export type LoadedSessionState = SessionMetadata & {
  cliArgs: ParsedCliArgs;
  history: HistoryItem[];
};

export type SessionPreviewItem = {
  id: string;
  cwd: string;
  updatedAt: number;
};

type DbTransaction = BetterSQLiteTransaction<
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>; // Drizzle doesn't export the transaction type directly

export type SessionSaveManager = {
  append: (history: HistoryItem[]) => Promise<boolean>;
  replace: (history: HistoryItem[]) => Promise<boolean>;
  switchSession: (sessionContext: SessionContext, previousHistory: HistoryItem[]) => void;
  flush: () => Promise<void>;
};

export function createSessionContext(
  cwd: string,
  transportKind: TransportKind = "local",
  cliArgs: ParsedCliArgs = { kind: "local" },
): SessionContext {
  return { id: randomUUID(), cwd, transportKind, cliArgs };
}

type SessionData = {
  state: LoadedSessionState;
  path: SessionPath;
};

async function loadSessionData(id: string): Promise<SessionData | null> {
  const tree = db().select().from(schema.trees).where(eq(schema.trees.name, id)).get();
  if (tree == null) return null;

  const leaf = db()
    .select({
      id: schema.treeNodes.id,
      parentId: schema.treeNodes.parentId,
      launchId: schema.treeNodes.launchId,
    })
    .from(schema.treeNodes)
    .where(and(eq(schema.treeNodes.treeId, tree.id), eq(schema.treeNodes.isLeaf, true)))
    .orderBy(desc(schema.treeNodes.id))
    .get();
  if (leaf == null) return null;

  const history: HistoryItem[] = [];
  const nodePath: SessionNode[] = [];
  let nodeId: number | null = leaf.id;
  while (nodeId != null) {
    const node = loadNode(nodeId);
    const historyItem = node.historyItem;
    history.push(historyItem);
    nodePath.push(node);
    nodeId = node.parentId;
  }
  history.reverse();
  nodePath.reverse();

  const cliArgs = loadLaunchArgs(leaf.launchId);
  return {
    state: {
      id: tree.name,
      cwd: tree.cwd,
      transportKind: cliArgs.kind === "local" ? "local" : "docker",
      cliArgs,
      history,
    },
    path: {
      treeId: tree.id,
      nodePath,
    },
  };
}

export async function loadSessionState(id: string): Promise<LoadedSessionState | null> {
  const data = await loadSessionData(id);
  return data?.state ?? null;
}

export async function loadSessionPath(id: string): Promise<SessionPath | null> {
  const data = await loadSessionData(id);
  return data?.path ?? null;
}

export async function listSessions(cwd?: string): Promise<SessionPreviewItem[]> {
  return db()
    .select({
      id: schema.trees.name,
      cwd: schema.trees.cwd,
      updatedAt: schema.trees.updatedAt,
    })
    .from(schema.trees)
    .where(cwd != null ? eq(schema.trees.cwd, cwd) : undefined)
    .orderBy(desc(schema.trees.updatedAt), desc(schema.trees.id))
    .all();
}

export function isSessionResumable(sessionId: string): boolean {
  const tree = db()
    .select({ id: schema.trees.id })
    .from(schema.trees)
    .where(eq(schema.trees.name, sessionId))
    .get();
  if (tree == null) return false;
  const node = db()
    .select({ id: schema.treeNodes.id })
    .from(schema.treeNodes)
    .where(eq(schema.treeNodes.treeId, tree.id))
    .get();
  return node != null;
}

export function createSessionSaveManager(
  sessionContext: SessionContext,
  initialHistory: HistoryItem[] = [],
  sessionPath?: SessionPath,
): SessionSaveManager {
  if (sessionPath != null && sessionPath.nodePath.length !== initialHistory.length) {
    throw new Error("Session history does not match its persisted node path");
  }

  let activeContext = sessionContext;
  let activePath: SessionPath | null = sessionPath
    ? { treeId: sessionPath.treeId, nodePath: [...sessionPath.nodePath] }
    : null;
  let launchId: number | null = null;
  let pendingSave: Promise<boolean> = Promise.resolve(false);

  const snapshot = () => ({ context: activeContext, path: activePath });

  function enqueue(operation: () => Promise<boolean>) {
    pendingSave = pendingSave.then(operation, operation);
    return pendingSave;
  }

  function append(history: HistoryItem[]): Promise<boolean> {
    if (!hasMessages(history)) return Promise.resolve(false);

    return enqueue(async () => {
      const { context, path } = snapshot();
      const pathLength = path?.nodePath.length ?? 0;
      const commonLength = commonPathPrefixLength(path?.nodePath ?? [], history);
      if (commonLength !== pathLength) {
        return replaceState(context, path, history, true);
      }
      if (history.length === pathLength) return false;
      return persistHistorySuffix(context, path, history, commonLength, true);
    });
  }

  async function replaceState(
    context: SessionContext,
    path: SessionPath | null,
    history: HistoryItem[],
    isCurrentSession: boolean,
  ): Promise<boolean> {
    const commonLength = commonPathPrefixLength(path?.nodePath ?? [], history);
    const newPath =
      path == null ? null : { treeId: path.treeId, nodePath: path.nodePath.slice(0, commonLength) };
    if (!hasMessages(history)) {
      if (isCurrentSession) activePath = newPath;
      return false;
    }

    if (commonLength === history.length) {
      if (isCurrentSession) activePath = newPath;
      return true;
    }

    return persistHistorySuffix(context, path, history, commonLength, isCurrentSession);
  }

  async function persistHistorySuffix(
    context: SessionContext,
    path: SessionPath | null,
    history: HistoryItem[],
    startingPosition: number,
    isCurrentSession: boolean,
  ): Promise<boolean> {
    const baseNodePath = path?.nodePath.slice(0, startingPosition) ?? [];
    const parentNodeId = baseNodePath.at(-1)?.nodeId ?? null;

    try {
      const result = await runWriteTransaction(tx => {
        const updatedAt = Date.now();
        const treeId = ensureTree(tx, context, updatedAt, path?.treeId);
        const persistedLaunchId = launchId ?? createLaunch(tx, context.cliArgs);
        const insertedNodeIds = insertHistoryNodes(
          tx,
          treeId,
          parentNodeId,
          persistedLaunchId,
          history.slice(startingPosition),
        );
        updateTreeTimestamp(tx, treeId, updatedAt);
        return { treeId, launchId: persistedLaunchId, insertedNodeIds };
      });

      launchId = result.launchId;
      if (isCurrentSession) {
        const newNodePath: SessionNode[] = history
          .slice(startingPosition)
          .map((historyItem, i) => ({
            nodeId: result.insertedNodeIds[i],
            parentId: parentNodeId,
            historyItem,
          }));
        activePath = { treeId: result.treeId, nodePath: [...baseNodePath, ...newNodePath] };
      }
      return true;
    } catch {
      return false;
    }
  }

  return {
    append,

    replace: history => {
      return enqueue(async () => {
        const { context, path } = snapshot();
        return replaceState(context, path, history, true);
      });
    },

    switchSession: (nextSessionContext, previousHistory): void => {
      const { context: previousContext, path: previousPath } = snapshot();
      activeContext = nextSessionContext;
      activePath = null;
      if (!hasMessages(previousHistory)) return;
      enqueue(async () => {
        const pathLength = previousPath?.nodePath.length ?? 0;
        const commonLength = commonPathPrefixLength(previousPath?.nodePath ?? [], previousHistory);
        if (commonLength !== pathLength) {
          return replaceState(previousContext, previousPath, previousHistory, false);
        }
        if (previousHistory.length === pathLength) return false;
        return persistHistorySuffix(
          previousContext,
          previousPath,
          previousHistory,
          commonLength,
          false,
        );
      });
    },

    flush: async () => {
      await pendingSave;
    },
  };
}

function hasMessages(history: HistoryItem[]): boolean {
  return history.some(item => item.type === "llm-ir");
}

function commonPathPrefixLength(nodePath: SessionNode[], history: HistoryItem[]): number {
  const length = Math.min(nodePath.length, history.length);
  let position = 0;
  while (
    position < length &&
    JSON.stringify(nodePath[position].historyItem) === JSON.stringify(history[position])
  ) {
    position++;
  }
  return position;
}

function ensureTree(
  tx: DbTransaction,
  context: SessionContext,
  updatedAt: number,
  expectedTreeId?: number | null,
): number {
  tx.insert(schema.trees)
    .values({
      name: context.id,
      cwd: context.cwd,
      updatedAt,
    })
    .onConflictDoNothing()
    .run();

  const tree = tx
    .select({ id: schema.trees.id, cwd: schema.trees.cwd })
    .from(schema.trees)
    .where(eq(schema.trees.name, context.id))
    .get();
  if (tree == null) throw new Error("Failed to create history tree");
  if (tree.cwd !== context.cwd) {
    throw new Error(`Session ${context.id} belongs to a different working directory`);
  }
  if (expectedTreeId != null && expectedTreeId !== tree.id) {
    throw new Error(`Session ${context.id} has a stale tree identifier`);
  }
  return tree.id;
}

function updateTreeTimestamp(tx: DbTransaction, treeId: number, updatedAt: number) {
  tx.update(schema.trees).set({ updatedAt }).where(eq(schema.trees.id, treeId)).run();
}

function createLaunch(tx: DbTransaction, cliArgs: ParsedCliArgs): number {
  let localLaunchId: number | null = null;
  let dockerLaunchId: number | null = null;
  const config = cliArgs.config ?? null;
  const unchained = !!cliArgs.unchained;
  switch (cliArgs.kind) {
    case "local":
      localLaunchId = tx
        .insert(schema.localLaunches)
        .values({
          config,
          unchained,
        })
        .returning({ id: schema.localLaunches.id })
        .get().id;
      break;
    case "docker-connect":
      dockerLaunchId = tx
        .insert(schema.dockerLaunches)
        .values({
          kind: "connect",
          target: cliArgs.target,
          dockerRunArgsJson: null,
          config,
          unchained,
        })
        .returning({ id: schema.dockerLaunches.id })
        .get().id;
      break;
    case "docker-run":
      dockerLaunchId = tx
        .insert(schema.dockerLaunches)
        .values({
          kind: "run",
          target: null,
          dockerRunArgsJson: JSON.stringify(cliArgs.dockerRunArgs),
          config,
          unchained,
        })
        .returning({ id: schema.dockerLaunches.id })
        .get().id;
      break;
  }

  return tx
    .insert(schema.launches)
    .values({ localLaunchId, dockerLaunchId })
    .returning({ id: schema.launches.id })
    .get().id;
}

function insertHistoryNodes(
  tx: DbTransaction,
  treeId: number,
  initialParentId: number | null,
  launchId: number,
  history: HistoryItem[],
): number[] {
  const nodeIds: number[] = [];
  let parentId = initialParentId;

  for (const item of history) {
    const historyItemId = insertHistoryItem(tx, item);
    const nodeId = tx
      .insert(schema.treeNodes)
      .values({
        historyItemId,
        treeId,
        parentId,
        isLeaf: true,
        launchId,
      })
      .returning({ id: schema.treeNodes.id })
      .get().id;
    nodeIds.push(nodeId);
    parentId = nodeId;
  }

  return nodeIds;
}

function insertHistoryItem(tx: DbTransaction, item: HistoryItem): number {
  let requestFailedId: number | null = null;
  let compactionFailedId: number | null = null;
  let notificationId: number | null = null;
  let llmIrId: number | null = null;

  switch (item.type) {
    case "llm-ir":
      llmIrId = tx
        .insert(schema.llmIrs)
        .values({ json: serializeLlmIr(item.ir) })
        .returning({ id: schema.llmIrs.id })
        .get().id;
      break;
    case "notification":
      notificationId = tx
        .insert(schema.notifications)
        .values({ content: item.content })
        .returning({ id: schema.notifications.id })
        .get().id;
      break;
    case "request-failed":
      requestFailedId = tx
        .insert(schema.requestFailedItems)
        .values({})
        .returning({ id: schema.requestFailedItems.id })
        .get().id;
      break;
    case "compaction-failed":
      compactionFailedId = tx
        .insert(schema.compactionFailedItems)
        .values({})
        .returning({ id: schema.compactionFailedItems.id })
        .get().id;
      break;
  }

  return tx
    .insert(schema.historyItems)
    .values({
      requestFailedId,
      compactionFailedId,
      notificationId,
      llmIrId,
    })
    .returning({ id: schema.historyItems.id })
    .get().id;
}

function loadNode(nodeId: number): SessionNode {
  const row = db()
    .select({
      id: schema.treeNodes.id,
      parentId: schema.treeNodes.parentId,
      requestFailedId: schema.requestFailedItems.id,
      compactionFailedId: schema.compactionFailedItems.id,
      notificationContent: schema.notifications.content,
      llmIrJson: schema.llmIrs.json,
    })
    .from(schema.treeNodes)
    .innerJoin(schema.historyItems, eq(schema.treeNodes.historyItemId, schema.historyItems.id))
    .leftJoin(
      schema.requestFailedItems,
      eq(schema.historyItems.requestFailedId, schema.requestFailedItems.id),
    )
    .leftJoin(
      schema.compactionFailedItems,
      eq(schema.historyItems.compactionFailedId, schema.compactionFailedItems.id),
    )
    .leftJoin(schema.notifications, eq(schema.historyItems.notificationId, schema.notifications.id))
    .leftJoin(schema.llmIrs, eq(schema.historyItems.llmIrId, schema.llmIrs.id))
    .where(eq(schema.treeNodes.id, nodeId))
    .get();
  if (row == null) throw new Error(`History node ${nodeId} is missing`);
  if (row.llmIrJson != null) {
    return {
      nodeId: row.id,
      parentId: row.parentId,
      historyItem: {
        type: "llm-ir",
        ir: deserializeLlmIr(row.llmIrJson),
      } as LlmIr,
    } as SessionNode;
  }
  if (row.notificationContent != null) {
    return {
      nodeId: row.id,
      parentId: row.parentId,
      historyItem: {
        type: "notification",
        content: row.notificationContent,
      } as NotificationRow,
    } as SessionNode;
  }
  if (row.requestFailedId != null) {
    return {
      nodeId: row.id,
      parentId: row.parentId,
      historyItem: {
        type: "request-failed",
      } as RequestFailedRow,
    } as SessionNode;
  }
  if (row.compactionFailedId != null) {
    return {
      nodeId: row.id,
      parentId: row.parentId,
      historyItem: {
        type: "compaction-failed",
      } as CompactionFailedRow,
    } as SessionNode;
  }
  throw new Error(`History node ${nodeId} has no valid history item`);
}

function loadLaunchArgs(launchId: number): ParsedCliArgs {
  const row = db()
    .select({
      localLaunchId: schema.launches.localLaunchId,
      localConfig: schema.localLaunches.config,
      localUnchained: schema.localLaunches.unchained,
      dockerLaunchId: schema.launches.dockerLaunchId,
      dockerKind: schema.dockerLaunches.kind,
      dockerTarget: schema.dockerLaunches.target,
      dockerRunArgsJson: schema.dockerLaunches.dockerRunArgsJson,
      dockerConfig: schema.dockerLaunches.config,
      dockerUnchained: schema.dockerLaunches.unchained,
    })
    .from(schema.launches)
    .leftJoin(schema.localLaunches, eq(schema.launches.localLaunchId, schema.localLaunches.id))
    .leftJoin(schema.dockerLaunches, eq(schema.launches.dockerLaunchId, schema.dockerLaunches.id))
    .where(eq(schema.launches.id, launchId))
    .get();
  if (row == null) throw new Error(`Launch ${launchId} is missing`);

  if (row.localLaunchId != null) {
    return {
      kind: "local",
      ...launchOptions(row.localConfig, row.localUnchained),
    };
  }
  if (row.dockerLaunchId == null || row.dockerKind == null) {
    throw new Error(`Launch ${launchId} has no launch details`);
  }

  const shared = launchOptions(row.dockerConfig, row.dockerUnchained);
  if (row.dockerKind === "connect") {
    if (row.dockerTarget == null) {
      throw new Error(`Docker launch ${row.dockerLaunchId} has no target`);
    }
    return { kind: "docker-connect", target: row.dockerTarget, ...shared };
  }
  if (row.dockerRunArgsJson == null) {
    throw new Error(`Docker launch ${row.dockerLaunchId} has no run arguments`);
  }
  return {
    kind: "docker-run",
    dockerRunArgs: parseStringArray(row.dockerRunArgsJson),
    ...shared,
  };
}

function launchOptions(config: string | null, unchained: boolean | null) {
  return {
    ...(config != null ? { config } : {}),
    ...(unchained ? { unchained: true as const } : {}),
  };
}

function parseStringArray(json: string): string[] {
  const value = JSON.parse(json) as unknown;
  if (!Array.isArray(value) || !value.every(item => typeof item === "string")) {
    throw new Error("Invalid Docker run arguments");
  }
  return value;
}

async function runWriteTransaction<T>(operation: (tx: DbTransaction) => T): Promise<T> {
  const maxAttempts = 4;
  for (let attempt = 0; ; attempt++) {
    try {
      return db().transaction(operation);
    } catch (error) {
      if (!isSqliteBusy(error) || attempt === maxAttempts - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 10 * 2 ** attempt));
    }
  }
}

function isSqliteBusy(error: unknown): boolean {
  if (typeof error !== "object" || error == null || !("code" in error)) return false;
  const code = String(error.code);
  return code === "SQLITE_BUSY" || code === "SQLITE_LOCKED";
}
