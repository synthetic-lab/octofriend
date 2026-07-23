import { ParsedCliArgs } from "../cli/cli-args.ts";
import { desc, eq } from "drizzle-orm";
import { db, DbTransaction, schema } from "../db/db.ts";
import { OctoIR } from "../ir/octo-ir.ts";
import {
  compactionFailedItems,
  historyItems,
  launches,
  llmIrs,
  notifications,
  previews,
  requestFailedItems,
  treeNodes,
  trees,
} from "./schema/session-history-schema.ts";
import { deserializeLlmIr, serializeLlmIr } from "./llm-ir-json.ts";
import { excerpt } from "./preview.ts";

export type TransportKind = "local" | "docker-connect" | "docker-run";

export type SessionPreviewType = "latest-user-message";

export type HistoryItem =
  | { type: "request-failed" }
  | { type: "compaction-failed" }
  | { type: "notification"; content: string }
  | { type: "llm-ir"; ir: OctoIR };

export type HistoryNode = HistoryItem & { nodeId: number };

export type SessionMetadata = {
  sessionId: string | null;
  cwd: string;
  cliArgs: ParsedCliArgs;
};

export type Session = {
  metadata: SessionMetadata;
  treeId: number | null;
  launchId: number | null;
};

export type LoadedSession = {
  session: Session;
  history: readonly HistoryNode[];
};

export type SessionSummary = {
  sessionId: string;
  updatedAt: number;
  preview: string | null;
};

export function createSession(cwd: string, cliArgs: ParsedCliArgs): Session {
  return {
    metadata: { sessionId: null, cwd, cliArgs },
    treeId: null,
    launchId: null,
  };
}

export function listSessions(cwd: string): SessionSummary[] {
  return db()
    .select({
      sessionId: trees.name,
      updatedAt: trees.updatedAt,
      preview: previews.preview,
    })
    .from(trees)
    .leftJoin(previews, eq(previews.sessionId, trees.name))
    .where(eq(trees.cwd, cwd))
    .orderBy(desc(trees.updatedAt))
    .all();
}

export function loadSession(sessionId: string): LoadedSession | null {
  const tree = loadSessionTree(sessionId);
  if (tree == null) return null;

  let mostRecentLeaf: SessionTreeNode | undefined;
  const nodesById = new Map<number, SessionTreeNode>();
  for (const node of tree.nodes) {
    nodesById.set(node.id, node);
    if (
      node.isLeaf &&
      (mostRecentLeaf == null ||
        node.createdAt > mostRecentLeaf.createdAt ||
        (node.createdAt === mostRecentLeaf.createdAt && node.id > mostRecentLeaf.id))
    ) {
      mostRecentLeaf = node;
    }
  }
  if (mostRecentLeaf == null) return null;

  const history: HistoryNode[] = [];
  const visitedNodeIds = new Set<number>();
  let current: SessionTreeNode | undefined = mostRecentLeaf;
  while (current != null) {
    visitedNodeIds.add(current.id);
    history.push(historyNodeFromRow(current));

    if (current.parentId == null) break;
    current = nodesById.get(current.parentId);
  }
  history.reverse();

  const cliArgs = cliArgsFromRow(mostRecentLeaf);
  return {
    session: {
      metadata: {
        sessionId,
        cwd: tree.cwd,
        cliArgs,
      },
      treeId: tree.id,
      launchId: null,
    },
    history,
  };
}

function loadSessionTree(sessionId: string) {
  return db()
    .query.trees.findFirst({
      where: (table, { eq }) => eq(table.name, sessionId),
      with: {
        nodes: {
          with: {
            historyItem: {
              with: {
                requestFailedItem: true,
                compactionFailedItem: true,
                notification: true,
                llmIr: true,
              },
            },
            launch: {
              with: {
                local: true,
                docker: true,
              },
            },
          },
        },
      },
    })
    .sync();
}

type SessionTree = NonNullable<ReturnType<typeof loadSessionTree>>;
type SessionTreeNode = SessionTree["nodes"][number];

function historyNodeFromRow(node: SessionTreeNode): HistoryNode {
  const item = node.historyItem;
  if (item.llmIr != null) {
    return { nodeId: node.id, type: "llm-ir", ir: deserializeLlmIr(item.llmIr.json) };
  }
  if (item.notification != null) {
    return { nodeId: node.id, type: "notification", content: item.notification.content };
  }
  if (item.requestFailedItem != null) return { nodeId: node.id, type: "request-failed" };
  if (item.compactionFailedItem != null) return { nodeId: node.id, type: "compaction-failed" };
  throw new Error(`History node ${node.id} has no payload.`);
}

function cliArgsFromRow(node: SessionTreeNode): ParsedCliArgs {
  const { local, docker } = node.launch;
  if (local != null) {
    return {
      kind: "local",
      config: local.config ?? undefined,
      unchained: local.unchained || undefined,
    };
  }
  if (docker == null) {
    throw new Error("Session history node has no launch configuration.");
  }
  if (docker.kind === "connect") {
    if (docker.containerTarget == null) {
      throw new Error("Docker connect launch has no container target.");
    }
    return {
      kind: "docker-connect",
      target: docker.containerTarget,
      config: docker.config ?? undefined,
      unchained: docker.unchained || undefined,
    };
  }
  if (docker.dockerRunArgsJson == null) throw new Error("Docker run launch has no arguments.");
  return {
    kind: "docker-run",
    dockerRunArgs: JSON.parse(docker.dockerRunArgsJson),
    config: docker.config ?? undefined,
    unchained: docker.unchained || undefined,
  };
}

function updateSessionPreview(
  tx: DbTransaction,
  sessionId: string,
  previewStr: string,
  previewType: SessionPreviewType,
) {
  tx.insert(previews)
    .values({
      preview: previewStr,
      sessionId,
      previewType,
    })
    .onConflictDoUpdate({
      target: previews.sessionId,
      set: {
        preview: previewStr,
        previewType,
      },
    })
    .run();
}

// If the historyItem is a user message with some non-empty text update the session's preview to be an excerpt of that.
function maybeUpdateSessionPreview(tx: DbTransaction, sessionId: string, historyItem: HistoryItem) {
  if (historyItem.type === "llm-ir") {
    if (historyItem.ir.role === "user") {
      const userMessageContent = historyItem.ir.content.find(
        content => content.type == "text",
      )?.content;
      if (userMessageContent) {
        updateSessionPreview(tx, sessionId, excerpt(userMessageContent), "latest-user-message");
      }
    }
  }
}

export function insertHistoryItems(
  session: Session,
  parentNodeId: number | null,
  itemsToInsert: HistoryItem[],
): HistoryNode[] {
  if (itemsToInsert.length === 0) return [];

  // sessionId is null until the first durable history item is persisted; generate it lazily.
  const sessionId = session.metadata.sessionId ?? crypto.randomUUID();
  if (session.metadata.sessionId == null) {
    session.metadata = { ...session.metadata, sessionId };
  }

  const result = db().transaction(tx => {
    // we don't create a session tree or uuid until at least one history item is available
    const treeId = session.treeId ?? createTree(tx, session.metadata);
    const launchId = session.launchId ?? createLaunch(tx, session.metadata.cliArgs);

    const insertedNodes: HistoryNode[] = [];
    let currParentId = parentNodeId;
    for (const historyItem of itemsToInsert) {
      const insertedHistoryItemId = insertHistoryItem(tx, historyItem);
      maybeUpdateSessionPreview(tx, sessionId, historyItem);
      const insertedTreeNode = tx
        .insert(treeNodes)
        .values({
          treeId,
          historyItemId: insertedHistoryItemId,
          parentId: currParentId,
          isLeaf: true,
          launchId,
        })
        .returning({ id: treeNodes.id })
        .get();
      insertedNodes.push({ ...historyItem, nodeId: insertedTreeNode.id });
      currParentId = insertedTreeNode.id;
    }
    tx.update(trees).set({ updatedAt: Date.now() }).where(eq(trees.id, treeId)).run();
    return { treeId, launchId, insertedNodes };
  });

  session.treeId = result.treeId;
  session.launchId = result.launchId;
  return result.insertedNodes;
}

function createTree(tx: DbTransaction, metadata: SessionMetadata): number {
  const sessionId = metadata.sessionId;
  if (sessionId == null) throw new Error("Cannot create a tree without a session id.");
  tx.insert(trees).values({ name: sessionId, cwd: metadata.cwd }).onConflictDoNothing().run();

  const tree = tx
    .select({ id: trees.id, cwd: trees.cwd })
    .from(trees)
    .where(eq(trees.name, sessionId))
    .get();
  if (tree == null) throw new Error("Failed to create history tree.");
  if (tree.cwd !== metadata.cwd) {
    throw new Error(`Session ${sessionId} belongs to a different working directory.`);
  }
  return tree.id;
}

function createLaunch(tx: DbTransaction, cliArgs: ParsedCliArgs): number {
  const shared = { config: cliArgs.config ?? null, unchained: !!cliArgs.unchained };
  let localLaunchId: number | null = null;
  let dockerLaunchId: number | null = null;

  if (cliArgs.kind === "local") {
    localLaunchId = tx
      .insert(schema.localLaunches)
      .values(shared)
      .returning({ id: schema.localLaunches.id })
      .get().id;
  } else {
    dockerLaunchId = tx
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

  return tx
    .insert(launches)
    .values({ localLaunchId, dockerLaunchId })
    .returning({ id: launches.id })
    .get().id;
}

function insertHistoryItem(tx: DbTransaction, item: HistoryItem): number {
  let requestFailedId: number | null = null;
  let compactionFailedId: number | null = null;
  let notificationId: number | null = null;
  let llmIrId: number | null = null;
  let persistedItem: HistoryItem;

  switch (item.type) {
    case "llm-ir": {
      const row = tx
        .insert(llmIrs)
        .values({ json: serializeLlmIr(item.ir) })
        .returning()
        .get();
      llmIrId = row.id;
      persistedItem = { type: "llm-ir", ir: deserializeLlmIr(row.json) };
      break;
    }
    case "notification": {
      const row = tx.insert(notifications).values({ content: item.content }).returning().get();
      notificationId = row.id;
      persistedItem = { type: "notification", content: row.content };
      break;
    }
    case "request-failed": {
      requestFailedId = tx
        .insert(requestFailedItems)
        .values({})
        .returning({ id: requestFailedItems.id })
        .get().id;
      persistedItem = { type: "request-failed" };
      break;
    }
    case "compaction-failed": {
      compactionFailedId = tx
        .insert(compactionFailedItems)
        .values({})
        .returning({ id: compactionFailedItems.id })
        .get().id;
      persistedItem = { type: "compaction-failed" };
      break;
    }
  }

  const insertedHistoryItem = tx
    .insert(historyItems)
    .values({ requestFailedId, compactionFailedId, notificationId, llmIrId })
    .returning({ id: historyItems.id })
    .get();
  return insertedHistoryItem.id;
}
