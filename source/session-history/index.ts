import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, type ExtractTablesWithRelations } from "drizzle-orm";
import { type BetterSQLiteTransaction } from "drizzle-orm/better-sqlite3";
import { db, schema } from "../db/db.ts";
import type { TransportKind } from "../transports/transport-common.ts";
import type { ParsedCliArgs } from "./cli-args.ts";
import { deserializeLlmIr, serializeLlmIr } from "./llm-ir-json.ts";
import {
  compactionFailedItems,
  CompactionFailedRow,
  dockerLaunches,
  historyItems,
  launches,
  LlmIrRow,
  llmIrs,
  localLaunches,
  NotificationRow,
  notifications,
  requestFailedItems,
  RequestFailedRow,
  treeNodes,
  trees,
} from "./schema/session-history-schema.ts";
import { OctoIR } from "../ir/octo-ir.ts";

export type RequestFailedHistoryItem = Omit<RequestFailedRow, "id"> & {
  type: "request-failed";
};

export type CompactionFailedHistoryItem = Omit<CompactionFailedRow, "id"> & {
  type: "compaction-failed";
};

export type NotificationHistoryItem = Omit<NotificationRow, "id"> & {
  type: "notification";
};

export type LlmIrHistoryItem = Omit<LlmIrRow, "id" | "json"> & {
  type: "llm-ir";
  ir: OctoIR;
};

export type HistoryItem =
  | RequestFailedHistoryItem
  | CompactionFailedHistoryItem
  | NotificationHistoryItem
  | LlmIrHistoryItem;

const SQLITE_BUSY_RETRY_ATTEMPTS = 4;
const SQLITE_BUSY_RETRY_DELAY_MS = 10;

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

export function createSessionContext(
  cwd: string,
  transportKind: TransportKind = "local",
  cliArgs: ParsedCliArgs = { kind: "local" },
): SessionContext {
  return { id: randomUUID(), cwd, transportKind, cliArgs };
}

type SessionRecord = {
  context: SessionContext;
  path: SessionPath | null;
};

type SessionData = {
  state: LoadedSessionState;
  path: SessionPath;
};

async function loadSessionData(id: string): Promise<SessionData | null> {
  const tree = db().select().from(trees).where(eq(trees.name, id)).get();
  if (tree == null) return null;

  const leaf = db()
    .select({
      id: treeNodes.id,
      parentId: treeNodes.parentId,
      launchId: treeNodes.launchId,
    })
    .from(treeNodes)
    .where(and(eq(treeNodes.treeId, tree.id), eq(treeNodes.isLeaf, true)))
    .orderBy(desc(treeNodes.id))
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
      id: trees.name,
      cwd: trees.cwd,
      updatedAt: trees.updatedAt,
    })
    .from(trees)
    .where(cwd != null ? eq(trees.cwd, cwd) : undefined)
    .orderBy(desc(trees.updatedAt), desc(trees.id))
    .all();
}

export function isSessionResumable(sessionId: string): boolean {
  const tree = db().select({ id: trees.id }).from(trees).where(eq(trees.name, sessionId)).get();
  if (tree == null) return false;
  const node = db()
    .select({ id: treeNodes.id })
    .from(treeNodes)
    .where(eq(treeNodes.treeId, tree.id))
    .get();
  return node != null;
}

export function createSessionHistory(
  sessionContext: SessionContext,
  initialHistory: HistoryItem[] = [],
  sessionPath?: SessionPath,
): SessionHistory {
  return new SessionHistory(sessionContext, initialHistory, sessionPath);
}

export class SessionHistory {
  private activeSession: SessionRecord;
  private launchId: number | null = null;
  private pendingSave: Promise<boolean> = Promise.resolve(false);

  constructor(
    sessionContext: SessionContext,
    initialHistory: HistoryItem[] = [],
    sessionPath?: SessionPath,
  ) {
    if (sessionPath != null && sessionPath.nodePath.length !== initialHistory.length) {
      throw new Error("Session history does not match its persisted node path");
    }

    this.activeSession = {
      context: sessionContext,
      path:
        sessionPath != null
          ? { treeId: sessionPath.treeId, nodePath: [...sessionPath.nodePath] }
          : null,
    };
  }

  append(history: HistoryItem[]): Promise<boolean> {
    if (!hasMessages(history)) return Promise.resolve(false);

    const session = this.activeSession;
    return this.enqueue(() => this.appendToSession(session, history));
  }

  replace(history: HistoryItem[]): Promise<boolean> {
    const session = this.activeSession;
    return this.enqueue(() => this.replaceState(session, history));
  }

  switchSession(nextSessionContext: SessionContext, previousHistory: HistoryItem[]): void {
    const previousSession = this.activeSession;
    this.activeSession = { context: nextSessionContext, path: null };
    if (!hasMessages(previousHistory)) return;

    void this.enqueue(() => this.appendToSession(previousSession, previousHistory));
  }

  async flush(): Promise<void> {
    await this.pendingSave;
  }

  private enqueue(operation: () => Promise<boolean>): Promise<boolean> {
    const nextSave = this.pendingSave.then(operation, operation);
    nextSave.catch(() => undefined);
    this.pendingSave = nextSave;
    return nextSave;
  }

  private appendToSession(session: SessionRecord, history: HistoryItem[]): Promise<boolean> {
    const pathLength = session.path?.nodePath.length ?? 0;
    const commonLength = commonPathPrefixLength(session.path?.nodePath ?? [], history);
    if (commonLength !== pathLength) {
      return this.replaceState(session, history);
    }
    if (history.length === pathLength) return Promise.resolve(false);
    return this.persistHistorySuffix(session, history, commonLength);
  }

  private async replaceState(session: SessionRecord, history: HistoryItem[]): Promise<boolean> {
    const commonLength = commonPathPrefixLength(session.path?.nodePath ?? [], history);
    const newPath =
      session.path == null
        ? null
        : { treeId: session.path.treeId, nodePath: session.path.nodePath.slice(0, commonLength) };
    if (!hasMessages(history)) {
      session.path = newPath;
      return false;
    }

    if (commonLength === history.length) {
      session.path = newPath;
      return true;
    }

    return this.persistHistorySuffix(session, history, commonLength);
  }

  private async persistHistorySuffix(
    session: SessionRecord,
    history: HistoryItem[],
    startingPosition: number,
  ): Promise<boolean> {
    const baseNodePath = session.path?.nodePath.slice(0, startingPosition) ?? [];
    const parentNodeId = baseNodePath.at(-1)?.nodeId ?? null;

    try {
      const result = await runWriteTransaction(tx => {
        const updatedAt = Date.now();
        const treeId = ensureTree(tx, session.context, updatedAt, session.path?.treeId);
        const persistedLaunchId = this.launchId ?? createLaunch(tx, session.context.cliArgs);
        const insertedNodes = insertHistoryNodes(
          tx,
          treeId,
          parentNodeId,
          persistedLaunchId,
          history.slice(startingPosition),
        );
        updateTreeTimestamp(tx, treeId, updatedAt);
        return { treeId, launchId: persistedLaunchId, insertedNodes };
      });

      this.launchId = result.launchId;
      session.path = {
        treeId: result.treeId,
        nodePath: [...baseNodePath, ...result.insertedNodes],
      };
      return true;
    } catch (error) {
      if (isRootNodeConflict(error, parentNodeId)) return false;
      throw error;
    }
  }
}

function hasMessages(history: HistoryItem[]): boolean {
  return history.some(item => item.type === "llm-ir");
}

function commonPathPrefixLength(nodePath: SessionNode[], history: HistoryItem[]): number {
  const length = Math.min(nodePath.length, history.length);
  let position = 0;
  while (position < length && sameHistoryItem(nodePath[position].historyItem, history[position])) {
    position++;
  }
  return position;
}

function sameHistoryItem(left: HistoryItem, right: HistoryItem): boolean {
  if (left.type !== right.type) return false;

  switch (left.type) {
    case "llm-ir":
      return right.type === "llm-ir" && isDeepStrictEqual(left.ir, right.ir);
    case "notification":
      return right.type === "notification" && left.content === right.content;
    case "request-failed":
    case "compaction-failed":
      return true;
  }
}

function ensureTree(
  tx: DbTransaction,
  context: SessionContext,
  updatedAt: number,
  expectedTreeId?: number | null,
): number {
  tx.insert(trees)
    .values({
      name: context.id,
      cwd: context.cwd,
      updatedAt,
    })
    .onConflictDoNothing()
    .run();

  const tree = tx
    .select({ id: trees.id, cwd: trees.cwd })
    .from(trees)
    .where(eq(trees.name, context.id))
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
  tx.update(trees).set({ updatedAt }).where(eq(trees.id, treeId)).run();
}

function createLaunch(tx: DbTransaction, cliArgs: ParsedCliArgs): number {
  let localLaunchId: number | null = null;
  let dockerLaunchId: number | null = null;
  const config = cliArgs.config ?? null;
  const unchained = !!cliArgs.unchained;
  switch (cliArgs.kind) {
    case "local":
      localLaunchId = tx
        .insert(localLaunches)
        .values({
          config,
          unchained,
        })
        .returning({ id: localLaunches.id })
        .get().id;
      break;
    case "docker-connect":
      dockerLaunchId = tx
        .insert(dockerLaunches)
        .values({
          kind: "connect",
          target: cliArgs.target,
          dockerRunArgsJson: null,
          config,
          unchained,
        })
        .returning({ id: dockerLaunches.id })
        .get().id;
      break;
    case "docker-run":
      dockerLaunchId = tx
        .insert(dockerLaunches)
        .values({
          kind: "run",
          target: null,
          dockerRunArgsJson: JSON.stringify(cliArgs.dockerRunArgs),
          config,
          unchained,
        })
        .returning({ id: dockerLaunches.id })
        .get().id;
      break;
  }

  return tx
    .insert(launches)
    .values({ localLaunchId, dockerLaunchId })
    .returning({ id: launches.id })
    .get().id;
}

function insertHistoryNodes(
  tx: DbTransaction,
  treeId: number,
  initialParentId: number | null,
  launchId: number,
  history: HistoryItem[],
): SessionNode[] {
  const nodes: SessionNode[] = [];
  let parentId = initialParentId;

  for (const historyItem of history) {
    const historyItemId = insertHistoryItem(tx, historyItem);
    const nodeId = tx
      .insert(treeNodes)
      .values({
        historyItemId,
        treeId,
        parentId,
        isLeaf: true,
        launchId,
      })
      .returning({ id: treeNodes.id })
      .get().id;
    nodes.push({ nodeId, parentId, historyItem });
    parentId = nodeId;
  }

  return nodes;
}

function insertHistoryItem(tx: DbTransaction, item: HistoryItem): number {
  let requestFailedId: number | null = null;
  let compactionFailedId: number | null = null;
  let notificationId: number | null = null;
  let llmIrId: number | null = null;

  switch (item.type) {
    case "llm-ir":
      llmIrId = tx
        .insert(llmIrs)
        .values({ json: serializeLlmIr(item.ir) })
        .returning({ id: llmIrs.id })
        .get().id;
      break;
    case "notification":
      notificationId = tx
        .insert(notifications)
        .values({ content: item.content })
        .returning({ id: notifications.id })
        .get().id;
      break;
    case "request-failed":
      requestFailedId = tx
        .insert(requestFailedItems)
        .values({})
        .returning({ id: requestFailedItems.id })
        .get().id;
      break;
    case "compaction-failed":
      compactionFailedId = tx
        .insert(compactionFailedItems)
        .values({})
        .returning({ id: compactionFailedItems.id })
        .get().id;
      break;
  }

  return tx
    .insert(historyItems)
    .values({
      requestFailedId,
      compactionFailedId,
      notificationId,
      llmIrId,
    })
    .returning({ id: historyItems.id })
    .get().id;
}

function loadNode(nodeId: number): SessionNode {
  const row = db()
    .select({
      id: treeNodes.id,
      parentId: treeNodes.parentId,
      requestFailedId: requestFailedItems.id,
      compactionFailedId: compactionFailedItems.id,
      notificationContent: notifications.content,
      llmIrJson: llmIrs.json,
    })
    .from(treeNodes)
    .innerJoin(historyItems, eq(treeNodes.historyItemId, historyItems.id))
    .leftJoin(requestFailedItems, eq(historyItems.requestFailedId, requestFailedItems.id))
    .leftJoin(compactionFailedItems, eq(historyItems.compactionFailedId, compactionFailedItems.id))
    .leftJoin(notifications, eq(historyItems.notificationId, notifications.id))
    .leftJoin(llmIrs, eq(historyItems.llmIrId, llmIrs.id))
    .where(eq(treeNodes.id, nodeId))
    .get();
  if (row == null) throw new Error(`History node ${nodeId} is missing`);
  if (row.llmIrJson != null) {
    return {
      nodeId: row.id,
      parentId: row.parentId,
      historyItem: {
        type: "llm-ir",
        ir: deserializeLlmIr(row.llmIrJson),
      },
    };
  }
  if (row.notificationContent != null) {
    return {
      nodeId: row.id,
      parentId: row.parentId,
      historyItem: {
        type: "notification",
        content: row.notificationContent,
      },
    };
  }
  if (row.requestFailedId != null) {
    return {
      nodeId: row.id,
      parentId: row.parentId,
      historyItem: {
        type: "request-failed",
      },
    };
  }
  if (row.compactionFailedId != null) {
    return {
      nodeId: row.id,
      parentId: row.parentId,
      historyItem: {
        type: "compaction-failed",
      },
    };
  }
  throw new Error(`History node ${nodeId} has no valid history item`);
}

function loadLaunchArgs(launchId: number): ParsedCliArgs {
  const row = db()
    .select({
      localLaunchId: launches.localLaunchId,
      localConfig: localLaunches.config,
      localUnchained: localLaunches.unchained,
      dockerLaunchId: launches.dockerLaunchId,
      dockerKind: dockerLaunches.kind,
      dockerTarget: dockerLaunches.target,
      dockerRunArgsJson: dockerLaunches.dockerRunArgsJson,
      dockerConfig: dockerLaunches.config,
      dockerUnchained: dockerLaunches.unchained,
    })
    .from(launches)
    .leftJoin(localLaunches, eq(launches.localLaunchId, localLaunches.id))
    .leftJoin(dockerLaunches, eq(launches.dockerLaunchId, dockerLaunches.id))
    .where(eq(launches.id, launchId))
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
  for (let attempt = 0; ; attempt++) {
    try {
      return db().transaction(operation);
    } catch (error) {
      if (!isSqliteBusy(error) || attempt === SQLITE_BUSY_RETRY_ATTEMPTS - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, SQLITE_BUSY_RETRY_DELAY_MS * 2 ** attempt));
    }
  }
}

function isRootNodeConflict(error: unknown, parentNodeId: number | null): boolean {
  if (parentNodeId != null || !isSqliteConstraint(error)) return false;
  const message = String(error);
  return (
    message.includes("tree_nodes_one_root_unique") ||
    (message.includes("tree_nodes") && message.includes("tree_id"))
  );
}

function isSqliteBusy(error: unknown): boolean {
  const code = sqliteErrorCode(error);
  return code === "SQLITE_BUSY" || code === "SQLITE_LOCKED";
}

function isSqliteConstraint(error: unknown): boolean {
  return sqliteErrorCode(error).startsWith("SQLITE_CONSTRAINT");
}

function sqliteErrorCode(error: unknown): string {
  if (typeof error !== "object" || error == null || !("code" in error)) return "";
  return String(error.code);
}
