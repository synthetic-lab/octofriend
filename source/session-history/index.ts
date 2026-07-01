import { ParsedCliArgs } from "../cli/cli-args.ts";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "../db/db.ts";
import { OctoIR } from "../ir/octo-ir.ts";
import {
  compactionFailedItems,
  dockerLaunches,
  historyItems,
  launches,
  llmIrs,
  localLaunches,
  notifications,
  requestFailedItems,
  treeNodes,
  trees,
} from "./schema/session-history-schema.ts";
import { deserializeLlmIr, serializeLlmIr } from "./llm-ir-json.ts";

export type TransportKind = "local" | "docker-connect" | "docker-run";

export type HistoryItem =
  | { type: "request-failed" }
  | { type: "compaction-failed" }
  | { type: "notification"; content: string }
  | { type: "llm-ir"; ir: OctoIR };

export type HistoryNode = HistoryItem & { nodeId: number };

export type SessionMetadata = {
  sessionId: string;
  cwd: string;
  transportKind: TransportKind;
  cliArgs: ParsedCliArgs;
};

export type Session = {
  metadata: SessionMetadata;
  treeId: number | null;
  launchId: number | null;
};

export type LoadedSession = {
  session: Session;
  history: HistoryNode[];
};

export function createSession(
  sessionId: string,
  cwd: string,
  transportKind: TransportKind,
  cliArgs: ParsedCliArgs,
): Session {
  return {
    metadata: { sessionId, cwd, transportKind, cliArgs },
    treeId: null,
    launchId: null,
  };
}

export function loadSession(sessionId: string): LoadedSession | null {
  const rows = db()
    .select({
      treeId: trees.id,
      cwd: trees.cwd,
      nodeId: treeNodes.id,
      parentId: treeNodes.parentId,
      isLeaf: treeNodes.isLeaf,
      nodeLaunchId: treeNodes.launchId,
      requestFailedId: historyItems.requestFailedId,
      compactionFailedId: historyItems.compactionFailedId,
      notificationContent: notifications.content,
      llmIrJson: llmIrs.json,
      localLaunchId: launches.localLaunchId,
      localConfig: localLaunches.config,
      localUnchained: localLaunches.unchained,
      dockerLaunchId: launches.dockerLaunchId,
      dockerKind: dockerLaunches.kind,
      dockerContainerTarget: dockerLaunches.containerTarget,
      dockerRunArgsJson: dockerLaunches.dockerRunArgsJson,
      dockerConfig: dockerLaunches.config,
      dockerUnchained: dockerLaunches.unchained,
    })
    .from(trees)
    .leftJoin(treeNodes, eq(treeNodes.treeId, trees.id))
    .leftJoin(historyItems, eq(historyItems.id, treeNodes.historyItemId))
    .leftJoin(requestFailedItems, eq(requestFailedItems.id, historyItems.requestFailedId))
    .leftJoin(compactionFailedItems, eq(compactionFailedItems.id, historyItems.compactionFailedId))
    .leftJoin(notifications, eq(notifications.id, historyItems.notificationId))
    .leftJoin(llmIrs, eq(llmIrs.id, historyItems.llmIrId))
    .leftJoin(launches, eq(launches.id, treeNodes.launchId))
    .leftJoin(localLaunches, eq(localLaunches.id, launches.localLaunchId))
    .leftJoin(dockerLaunches, eq(dockerLaunches.id, launches.dockerLaunchId))
    .where(eq(trees.name, sessionId))
    .orderBy(desc(treeNodes.id))
    .all();

  const mostRecentLeaf = rows.find(row => row.nodeId != null && row.isLeaf);
  if (mostRecentLeaf?.nodeId == null || mostRecentLeaf.nodeLaunchId == null) return null;

  const rowsByNodeId = new Map<number, (typeof rows)[number]>();
  for (const row of rows) {
    if (row.nodeId != null) rowsByNodeId.set(row.nodeId, row);
  }

  const history: HistoryNode[] = [];
  const visited = new Set<number>();
  let current: (typeof rows)[number] | undefined = mostRecentLeaf;
  while (current?.nodeId != null) {
    if (visited.has(current.nodeId)) {
      throw new Error(`Session ${sessionId} contains a cycle in its history tree.`);
    }
    visited.add(current.nodeId);
    history.push(historyItemFromRow(current));
    if (current.parentId == null) break;
    current = rowsByNodeId.get(current.parentId);
    if (current == null) {
      throw new Error(`Session ${sessionId} contains a history node with a missing parent.`);
    }
  }
  history.reverse();

  const cliArgs = cliArgsFromRow(mostRecentLeaf);
  return {
    session: {
      metadata: {
        sessionId,
        cwd: mostRecentLeaf.cwd,
        transportKind: cliArgs.kind,
        cliArgs,
      },
      treeId: mostRecentLeaf.treeId,
      launchId: null,
    },
    history,
  };
}

function historyItemFromRow(row: {
  nodeId: number | null;
  requestFailedId: number | null;
  compactionFailedId: number | null;
  notificationContent: string | null;
  llmIrJson: string | null;
}): HistoryNode {
  if (row.nodeId == null) throw new Error("Cannot load a history item without a tree node.");
  if (row.llmIrJson != null) {
    return { nodeId: row.nodeId, type: "llm-ir", ir: deserializeLlmIr(row.llmIrJson) };
  }
  if (row.notificationContent != null) {
    return { nodeId: row.nodeId, type: "notification", content: row.notificationContent };
  }
  if (row.requestFailedId != null) return { nodeId: row.nodeId, type: "request-failed" };
  if (row.compactionFailedId != null) return { nodeId: row.nodeId, type: "compaction-failed" };
  throw new Error(`History node ${row.nodeId} has no payload.`);
}

function cliArgsFromRow(row: {
  localLaunchId: number | null;
  localConfig: string | null;
  localUnchained: boolean | null;
  dockerLaunchId: number | null;
  dockerKind: "connect" | "run" | null;
  dockerContainerTarget: string | null;
  dockerRunArgsJson: string | null;
  dockerConfig: string | null;
  dockerUnchained: boolean | null;
}): ParsedCliArgs {
  if (row.localLaunchId != null) {
    return {
      kind: "local",
      config: row.localConfig ?? undefined,
      unchained: row.localUnchained || undefined,
    };
  }
  if (row.dockerLaunchId == null || row.dockerKind == null) {
    throw new Error("Session history node has no launch configuration.");
  }
  if (row.dockerKind === "connect") {
    if (row.dockerContainerTarget == null) {
      throw new Error("Docker connect launch has no container target.");
    }
    return {
      kind: "docker-connect",
      target: row.dockerContainerTarget,
      config: row.dockerConfig ?? undefined,
      unchained: row.dockerUnchained || undefined,
    };
  }
  if (row.dockerRunArgsJson == null) throw new Error("Docker run launch has no arguments.");
  return {
    kind: "docker-run",
    dockerRunArgs: JSON.parse(row.dockerRunArgsJson),
    config: row.dockerConfig ?? undefined,
    unchained: row.dockerUnchained || undefined,
  };
}

export function insertHistoryItems(
  session: Session,
  parentNodeId: number | null,
  itemsToInsert: HistoryItem[],
): HistoryNode[] {
  if (itemsToInsert.length === 0) return [];

  const treeId = session.treeId ?? createTree(session.metadata);
  const launchId = session.launchId ?? createLaunch(session.metadata.cliArgs);
  session.treeId = treeId;
  session.launchId = launchId;

  const inserted: HistoryNode[] = [];
  let parentId = parentNodeId;
  for (const item of itemsToInsert) {
    const payload = insertHistoryItem(item);
    const node = db()
      .insert(treeNodes)
      .values({
        treeId,
        historyItemId: payload.id,
        parentId,
        isLeaf: true,
        launchId,
      })
      .returning({ nodeId: treeNodes.id })
      .get();
    inserted.push({ ...payload.item, nodeId: node.nodeId });
    parentId = node.nodeId;
  }

  db().update(trees).set({ updatedAt: Date.now() }).where(eq(trees.id, treeId)).run();
  return inserted;
}

function createTree(metadata: SessionMetadata): number {
  db()
    .insert(trees)
    .values({ name: metadata.sessionId, cwd: metadata.cwd, updatedAt: Date.now() })
    .onConflictDoNothing()
    .run();

  const tree = db()
    .select({ id: trees.id, cwd: trees.cwd })
    .from(trees)
    .where(eq(trees.name, metadata.sessionId))
    .get();
  if (tree == null) throw new Error("Failed to create history tree.");
  if (tree.cwd !== metadata.cwd) {
    throw new Error(`Session ${metadata.sessionId} belongs to a different working directory.`);
  }
  return tree.id;
}

function createLaunch(cliArgs: ParsedCliArgs): number {
  const shared = { config: cliArgs.config ?? null, unchained: !!cliArgs.unchained };
  let localLaunchId: number | null = null;
  let dockerLaunchId: number | null = null;

  if (cliArgs.kind === "local") {
    localLaunchId = db()
      .insert(schema.localLaunches)
      .values(shared)
      .returning({ id: schema.localLaunches.id })
      .get().id;
  } else {
    dockerLaunchId = db()
      .insert(schema.dockerLaunches)
      .values({
        ...shared,
        kind: cliArgs.kind === "docker-connect" ? "connect" : "run",
        containerTarget: cliArgs.kind === "docker-connect" ? cliArgs.target : null,
        dockerRunArgsJson:
          cliArgs.kind === "docker-run" ? JSON.stringify(cliArgs.dockerRunArgs) : null,
      })
      .returning({ id: schema.dockerLaunches.id })
      .get().id;
  }

  return db()
    .insert(launches)
    .values({ localLaunchId, dockerLaunchId })
    .returning({ id: launches.id })
    .get().id;
}

function insertHistoryItem(item: HistoryItem): { id: number; item: HistoryItem } {
  let requestFailedId: number | null = null;
  let compactionFailedId: number | null = null;
  let notificationId: number | null = null;
  let llmIrId: number | null = null;
  let persistedItem: HistoryItem;

  switch (item.type) {
    case "llm-ir": {
      const row = db()
        .insert(llmIrs)
        .values({ json: serializeLlmIr(item.ir) })
        .returning()
        .get();
      llmIrId = row.id;
      persistedItem = { type: "llm-ir", ir: deserializeLlmIr(row.json) };
      break;
    }
    case "notification": {
      const row = db().insert(notifications).values({ content: item.content }).returning().get();
      notificationId = row.id;
      persistedItem = { type: "notification", content: row.content };
      break;
    }
    case "request-failed": {
      requestFailedId = db()
        .insert(requestFailedItems)
        .values({})
        .returning({ id: requestFailedItems.id })
        .get().id;
      persistedItem = { type: "request-failed" };
      break;
    }
    case "compaction-failed": {
      compactionFailedId = db()
        .insert(compactionFailedItems)
        .values({})
        .returning({ id: compactionFailedItems.id })
        .get().id;
      persistedItem = { type: "compaction-failed" };
      break;
    }
  }

  const historyItem = db()
    .insert(historyItems)
    .values({ requestFailedId, compactionFailedId, notificationId, llmIrId })
    .returning({ id: historyItems.id })
    .get();
  return { id: historyItem.id, item: persistedItem };
}
