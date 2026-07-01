import { ParsedCliArgs } from "../cli/cli-args.ts";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, DbTransaction, isSqliteBusyError, schema } from "../db/db.ts";
import { OctoIR } from "../ir/octo-ir.ts";
import { commonPathPrefixLength, hasMessages } from "./history-utils.ts";
import {
  RequestFailedRow,
  CompactionFailedRow,
  NotificationRow,
  LlmIrRow,
  trees,
  launches,
  treeNodes,
  llmIrs,
  notifications,
  requestFailedItems,
  compactionFailedItems,
  historyItems,
  TreeNodeRow,
} from "./schema/session-history-schema.ts";
import { deserializeLlmIr, serializeLlmIr } from "./llm-ir-json.ts";

const SQLITE_BUSY_RETRY_ATTEMPTS = 4;

export type TransportKind = "local" | "docker-connect" | "docker-run";

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

export type SessionNode = {
  nodeId: number;
  parentId: number | null;
  historyItem: HistoryItem;
};

export type SessionMetadata = {
  sessionId: string;
  cwd: string;
  transportKind: TransportKind;
  cliArgs: ParsedCliArgs;
};

export type SessionRecord = {
  metadata: SessionMetadata;
  nodePath: SessionNode[];
};

export function createSessionRecord(
  sessionId: string,
  cwd: string,
  transportKind: TransportKind,
  cliArgs: ParsedCliArgs,
): SessionRecord {
  return {
    metadata: { sessionId, cwd, transportKind, cliArgs },
    nodePath: [],
  };
}

export async function loadSessionRecord(sessionId: string): Promise<SessionRecord | null> {
  return runWriteTransaction(tx => {
    const tree = tx
      .select({ id: trees.id, cwd: trees.cwd })
      .from(trees)
      .where(eq(trees.name, sessionId))
      .get();

    if (tree == null) return null;

    const mostRecentLeaf = tx
      .select()
      .from(treeNodes)
      .where(and(eq(treeNodes.treeId, tree.id), eq(treeNodes.isLeaf, true)))
      .orderBy(desc(treeNodes.id))
      .limit(1)
      .get();

    if (mostRecentLeaf == null) return null;

    const metadata = loadSessionMetadata(tx, sessionId, tree.cwd, mostRecentLeaf.launchId);
    if (metadata == null) return null;

    const nodePath = loadNodePathToLeaf(tx, mostRecentLeaf);
    return { metadata, nodePath } satisfies SessionRecord;
  });
}

function loadSessionMetadata(
  tx: DbTransaction,
  sessionId: string,
  cwd: string,
  launchId: number,
): SessionMetadata | null {
  const cliArgs = loadCliArgsFromLaunch(tx, launchId);
  if (cliArgs == null) return null;

  return {
    sessionId,
    cwd,
    transportKind: cliArgs.kind,
    cliArgs,
  };
}

function loadCliArgsFromLaunch(tx: DbTransaction, launchId: number): ParsedCliArgs | null {
  const launch = tx
    .select({
      localLaunchId: launches.localLaunchId,
      dockerLaunchId: launches.dockerLaunchId,
    })
    .from(launches)
    .where(eq(launches.id, launchId))
    .get()!;

  if (launch.localLaunchId != null) {
    const local = tx
      .select({ config: schema.localLaunches.config, unchained: schema.localLaunches.unchained })
      .from(schema.localLaunches)
      .where(eq(schema.localLaunches.id, launch.localLaunchId))
      .get()!;
    return {
      kind: "local",
      config: local.config ?? undefined,
      unchained: local.unchained || undefined,
    };
  }

  if (launch.dockerLaunchId != null) {
    const docker = tx
      .select({
        kind: schema.dockerLaunches.kind,
        containerTarget: schema.dockerLaunches.containerTarget,
        dockerRunArgsJson: schema.dockerLaunches.dockerRunArgsJson,
        config: schema.dockerLaunches.config,
        unchained: schema.dockerLaunches.unchained,
      })
      .from(schema.dockerLaunches)
      .where(eq(schema.dockerLaunches.id, launch.dockerLaunchId))
      .get()!;
    if (docker.kind === "connect") {
      return {
        kind: "docker-connect",
        target: docker.containerTarget!,
        config: docker.config ?? undefined,
        unchained: docker.unchained || undefined,
      };
    }
    return {
      kind: "docker-run",
      dockerRunArgs: JSON.parse(docker.dockerRunArgsJson!),
      config: docker.config ?? undefined,
      unchained: docker.unchained || undefined,
    };
  }

  return null;
}

function loadNodePathToLeaf(tx: DbTransaction, mostRecentLeaf: TreeNodeRow): SessionNode[] {
  const nodePathToRoot: TreeNodeRow[] = [mostRecentLeaf];
  let currentParentId = mostRecentLeaf.parentId;
  while (currentParentId != null) {
    const parent = tx.select().from(treeNodes).where(eq(treeNodes.id, currentParentId)).get()!;
    nodePathToRoot.push(parent);
    currentParentId = parent.parentId;
  }

  const nodePathToLeaf = nodePathToRoot.reverse();

  return nodePathToLeaf.map(node => ({
    nodeId: node.id,
    parentId: node.parentId,
    historyItem: loadHistoryItem(tx, node.historyItemId),
  }));
}

function loadHistoryItem(tx: DbTransaction, historyItemId: number): HistoryItem {
  const row = tx
    .select({
      requestFailedId: historyItems.requestFailedId,
      compactionFailedId: historyItems.compactionFailedId,
      notificationId: historyItems.notificationId,
      llmIrId: historyItems.llmIrId,
    })
    .from(historyItems)
    .where(eq(historyItems.id, historyItemId))
    .get()!;

  if (row.llmIrId != null) {
    const llmIrRow = tx
      .select({ json: llmIrs.json })
      .from(llmIrs)
      .where(eq(llmIrs.id, row.llmIrId))
      .get()!;
    return { type: "llm-ir", ir: deserializeLlmIr(llmIrRow.json) };
  }
  if (row.notificationId != null) {
    const notificationRow = tx
      .select({ content: notifications.content })
      .from(notifications)
      .where(eq(notifications.id, row.notificationId))
      .get()!;
    return { type: "notification", content: notificationRow.content };
  }
  if (row.requestFailedId != null) {
    return { type: "request-failed" };
  }
  return { type: "compaction-failed" };
}

async function runWriteTransaction<T>(operation: (tx: DbTransaction) => T): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return db().transaction(operation);
    } catch (err) {
      if (!isSqliteBusyError(err) || attempt >= SQLITE_BUSY_RETRY_ATTEMPTS) {
        // todo: not sure if i should actually throw or just ignore... don't want people to have their octo not work
        // just cuz the sql is super busy
        throw err;
      }
    }
  }
}

function validateAndGetTreeId(
  tx: DbTransaction,
  metadata: SessionMetadata,
  updatedAt: number,
): number {
  const expectedTreeName = metadata.sessionId; // a tree's name is the UUID of the session
  tx.insert(trees)
    .values({
      name: expectedTreeName,
      cwd: metadata.cwd,
      updatedAt,
    })
    .onConflictDoNothing()
    .run();
  const tree = tx
    .select({ id: trees.id, name: trees.name, cwd: trees.cwd })
    .from(trees)
    .where(eq(trees.name, expectedTreeName))
    .get();
  if (tree == null) {
    throw new Error("Failed to create history tree.");
  }
  if (tree.cwd !== metadata.cwd) {
    throw new Error(`Session ${expectedTreeName} belongs to a different working directory`);
  }
  if (expectedTreeName != null && expectedTreeName !== tree.name) {
    throw new Error(`Session ${metadata.sessionId} has a stale tree identifier`);
  }
  return tree.id;
}

function createLaunch(tx: DbTransaction, cliArgs: ParsedCliArgs) {
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
          containerTarget: cliArgs.target,
          config,
          unchained,
          dockerRunArgsJson: null,
        })
        .returning({ id: schema.dockerLaunches.id })
        .get().id;
      break;
    case "docker-run":
      dockerLaunchId = tx
        .insert(schema.dockerLaunches)
        .values({
          kind: "run",
          containerTarget: null,
          config,
          unchained,
          dockerRunArgsJson: JSON.stringify(cliArgs.dockerRunArgs),
        })
        .returning({ id: schema.dockerLaunches.id })
        .get().id;
      break;
  }
  return tx
    .insert(launches)
    .values({ localLaunchId, dockerLaunchId })
    .returning({ id: launches.id })
    .get().id;
}

function updateTreeTimestamp(tx: DbTransaction, treeId: number, updatedAt: number) {
  tx.update(trees).set({ updatedAt }).where(eq(trees.id, treeId)).run();
}

function insertHistoryItem(tx: DbTransaction, historyItem: HistoryItem): number {
  let requestFailedId: number | null = null;
  let compactionFailedId: number | null = null;
  let notificationId: number | null = null;
  let llmIrId: number | null = null;

  switch (historyItem.type) {
    case "llm-ir":
      llmIrId = tx
        .insert(llmIrs)
        .values({ json: serializeLlmIr(historyItem.ir) })
        .returning({ id: llmIrs.id })
        .get().id;
      break;
    case "notification":
      notificationId = tx
        .insert(notifications)
        .values({ content: historyItem.content })
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

function insertTreeNodes(
  tx: DbTransaction,
  treeId: number,
  initialParentNodeId: number | null,
  launchId: number,
  history: HistoryItem[],
): SessionNode[] {
  const nodePath: SessionNode[] = [];
  let parentId = initialParentNodeId;
  for (const historyItem of history) {
    const historyItemId = insertHistoryItem(tx, historyItem);
    const nodeId = tx
      .insert(treeNodes)
      .values({
        treeId,
        historyItemId,
        parentId,
        isLeaf: true,
        launchId,
      })
      .returning({ id: treeNodes.id })
      .get().id;
    nodePath.push({ nodeId, historyItem, parentId });
    parentId = nodeId;
  }
  return nodePath;
}

export class SessionHistory {
  private activeSession: SessionRecord;
  private launchId: number | null = null;
  private pendingSave: Promise<boolean> = Promise.resolve(false);
  constructor(sessionRecord: SessionRecord) {
    this.activeSession = sessionRecord;
  }

  private enqueue(operation: () => Promise<boolean>): Promise<boolean> {
    const nextSave = this.pendingSave.then(operation, operation);
    nextSave.catch(() => undefined);

    this.pendingSave = nextSave;
    return nextSave;
  }

  private appendToSession(session: SessionRecord, history: HistoryItem[]): Promise<boolean> {
    const nodePathLength = session.nodePath.length;
    const commonLength = commonPathPrefixLength(session.nodePath, history);

    if (history.length <= nodePathLength) {
      throw new Error(
        "Cannot append to session: the history path is not longer than the current session path.",
      );
    }
    if (nodePathLength !== commonLength) {
      throw new Error(
        "Cannot append to session: the current session path does not match the history path.",
      );
    }
    return this.persistHistory(session, history.slice(commonLength));
  }

  private async fullyReplaceSessionState(
    session: SessionRecord,
    history: HistoryItem[],
  ): Promise<boolean> {
    const commonLength = commonPathPrefixLength(session.nodePath, history);
    const updatedPath = session.nodePath.slice(0, commonLength);

    if (!hasMessages(history)) {
      session.nodePath = updatedPath;
      return false;
    }

    if (commonLength === history.length) {
      session.nodePath = updatedPath;
      return true;
    }
    return this.persistHistory(session, history.slice(commonLength));
  }

  private async persistHistory(
    session: SessionRecord,
    newHistory: HistoryItem[],
  ): Promise<boolean> {
    const { nodePath, metadata } = session;
    const parentNodeId = nodePath.at(-1)?.nodeId ?? null;

    if (nodePath.length > 0 && parentNodeId == null) {
      throw new Error("Session path is not empty, but no parent node ID found.");
    }

    try {
      const result = await runWriteTransaction(tx => {
        const updatedAt = Date.now();
        const treeId = validateAndGetTreeId(tx, metadata, updatedAt);
        const persistedLaunchId = this.launchId ?? createLaunch(tx, metadata.cliArgs);
        const newNodes = insertTreeNodes(tx, treeId, parentNodeId, persistedLaunchId, newHistory);
        updateTreeTimestamp(tx, treeId, updatedAt);
        return { treeId, launchId: persistedLaunchId, newNodes };
      });
      this.launchId = result.launchId;
      session.nodePath = [...nodePath, ...result.newNodes];
      return true;
    } catch (err) {
      // todo: not sure if i should actually throw or just ignore... don't want people to have their octo not work
      // just cuz the sql is super busy
      throw err;
    }
  }

  append(history: HistoryItem[]): Promise<boolean> {
    if (!hasMessages(history)) return Promise.resolve(false);

    const session = this.activeSession;
    return this.enqueue(() => this.appendToSession(session, history));
  }

  replace(history: HistoryItem[]): Promise<boolean> {
    const session = this.activeSession;
    return this.enqueue(() => this.fullyReplaceSessionState(session, history));
  }

  async startNewSession(): Promise<string> {
    await this.flush();

    const sessionId = randomUUID();
    const { cwd, transportKind, cliArgs } = this.activeSession.metadata;
    this.activeSession = createSessionRecord(sessionId, cwd, transportKind, cliArgs);
    this.launchId = null;
    return sessionId;
  }

  async flush(): Promise<void> {
    await this.pendingSave;
  }
}
