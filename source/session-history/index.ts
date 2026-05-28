import { randomUUID } from "crypto";
import { desc, eq, max } from "drizzle-orm";
import { db, schema } from "../db/db.ts";
import type { HistoryItem } from "../history.ts";
import type { TransportKind } from "../transports/transport-common.ts";
import { deserializeCliArgs, serializeCliArgs, type ParsedCliArgs } from "./cli-args.ts";
import { deserializeLlmIr, serializeLlmIr } from "./llm-ir-json.ts";

export type SessionContext = {
  id: string;
  cwd: string;
  transportKind: TransportKind;
  cliArgs: ParsedCliArgs;
};

export type SessionState = SessionContext & {
  history: HistoryItem[];
};

export type SessionSaveManager = {
  append: (history: HistoryItem[]) => Promise<boolean>;
  replace: (history: HistoryItem[]) => Promise<boolean>;
  switchSession: (sessionContext: SessionContext, previousHistory: HistoryItem[]) => void;
  flush: () => Promise<void>;
};

export type ActiveSession = {
  context: SessionContext | null;
  isResumable: boolean;
  initialHistoryLength: number;
};

type HistoryItemInsert = typeof schema.historyItems.$inferInsert;
type HistorySessionDbRow = typeof schema.historySessions.$inferSelect;
type HistoryItemDbRow = typeof schema.historyItems.$inferSelect;

export function createSessionContext(
  cwd: string,
  transportKind: TransportKind = "local",
  cliArgs: ParsedCliArgs = { kind: "local" },
): SessionContext {
  const id = randomUUID();
  return { id, cwd, transportKind, cliArgs };
}

export async function loadSessionState(id: string): Promise<SessionState | null> {
  const session = await db().query.historySessions.findFirst({
    where: (table, { eq }) => eq(table.id, id),
  });
  if (session == null) return null;

  const historyItemDbRows = await db().query.historyItems.findMany({
    where: (table, { eq }) => eq(table.sessionId, id),
    orderBy: (table, { asc }) => asc(table.position),
  });

  return {
    id,
    cwd: session.cwd,
    transportKind: session.transportKind,
    cliArgs: deserializeCliArgs(session.launchCommandArgsJson),
    history: historyItemDbRows.map(dbRowToHistoryItem),
  };
}

async function replaceSessionHistory(
  sessionContext: SessionContext,
  history: HistoryItem[],
): Promise<boolean> {
  const now = Date.now();

  try {
    db().transaction(tx => {
      if (!hasMessages(history)) {
        tx.delete(schema.historyItems)
          .where(eq(schema.historyItems.sessionId, sessionContext.id))
          .run();
        tx.delete(schema.historySessions)
          .where(eq(schema.historySessions.id, sessionContext.id))
          .run();
        return;
      }

      createSessionIfMissing(tx, sessionContext, now);
      tx.delete(schema.historyItems)
        .where(eq(schema.historyItems.sessionId, sessionContext.id))
        .run();
      insertHistoryItems(tx, sessionContext.id, history, 0);
      touchSession(tx, sessionContext.id, now);
    });
    return hasMessages(history);
  } catch {
    // TODO, should we tell the user about the failure?
    return false;
  }
}

function hasMessages(history: HistoryItem[]): boolean {
  return history.some(item => item.type === "llm-ir");
}

export async function listSessions(cwd?: string): Promise<HistorySessionDbRow[]> {
  return await db()
    .select()
    .from(schema.historySessions)
    .where(cwd != null ? eq(schema.historySessions.cwd, cwd) : undefined)
    .orderBy(desc(schema.historySessions.updatedAt));
}

type SessionSaveTarget = {
  context: SessionContext;
  lastSavedLength: number;
};

export function createSessionSaveManager(
  sessionContext: SessionContext,
  initialHistoryLength = 0,
): SessionSaveManager {
  let activeTarget: SessionSaveTarget = {
    context: sessionContext,
    lastSavedLength: initialHistoryLength,
  };
  let pendingSave: Promise<boolean> = Promise.resolve(false);

  function enqueue(operation: () => Promise<boolean>) {
    pendingSave = pendingSave.then(operation, operation);
    return pendingSave;
  }

  function append(target: SessionSaveTarget, history: HistoryItem[]): Promise<boolean> {
    if (!hasMessages(history)) return Promise.resolve(false);
    const currentLength = history.length;

    return enqueue(async () => {
      if (currentLength <= target.lastSavedLength) return false;
      const saved = await appendHistoryFromPosition(
        target.context,
        history,
        target.lastSavedLength,
      );
      if (saved) target.lastSavedLength = currentLength;
      return saved;
    });
  }

  function replace(target: SessionSaveTarget, history: HistoryItem[]): Promise<boolean> {
    const currentLength = history.length;

    return enqueue(async () => {
      const saved = await replaceSessionHistory(target.context, history);
      if (!saved) {
        target.lastSavedLength = getPersistedLength(target.context.id);
      } else {
        target.lastSavedLength = currentLength;
      }
      return saved;
    });
  }

  return {
    append: (history: HistoryItem[]) => append(activeTarget, history),

    replace: (history: HistoryItem[]) => replace(activeTarget, history),

    switchSession: (nextSessionContext: SessionContext, previousHistory: HistoryItem[]): void => {
      const previousTarget = activeTarget;
      append(previousTarget, previousHistory);
      activeTarget = {
        context: nextSessionContext,
        lastSavedLength: 0,
      };
    },

    flush: async () => {
      await pendingSave;
    },
  };
}

function getPersistedLength(sessionId: string): number {
  const row = db()
    .select({ position: max(schema.historyItems.position) })
    .from(schema.historyItems)
    .where(eq(schema.historyItems.sessionId, sessionId))
    .get();
  return row?.position != null ? row.position + 1 : 0;
}

async function appendHistoryFromPosition(
  sessionContext: SessionContext,
  history: HistoryItem[],
  startingPosition: number,
): Promise<boolean> {
  if (!hasMessages(history)) return false;

  const now = Date.now();

  try {
    db().transaction(tx => {
      createSessionIfMissing(tx, sessionContext, now);
      insertHistoryItems(tx, sessionContext.id, history, startingPosition);
      touchSession(tx, sessionContext.id, now);
    });
    return true;
  } catch {
    return false;
  }
}

function createSessionIfMissing(
  tx: Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0],
  sessionContext: SessionContext,
  now: number,
) {
  tx.insert(schema.historySessions)
    .values({
      id: sessionContext.id,
      cwd: sessionContext.cwd,
      transportKind: sessionContext.transportKind,
      launchCommandArgsJson: serializeCliArgs(sessionContext.cliArgs),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();
}

function touchSession(
  tx: Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0],
  sessionId: string,
  now: number,
) {
  tx.update(schema.historySessions)
    .set({ updatedAt: now })
    .where(eq(schema.historySessions.id, sessionId))
    .run();
}

function insertHistoryItems(
  tx: Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0],
  sessionId: string,
  history: HistoryItem[],
  startingPosition: number,
) {
  for (let position = startingPosition; position < history.length; position++) {
    const historyItem = history[position];
    tx.insert(schema.historyItems)
      .values(historyItemToDbRow(sessionId, position, historyItem))
      .run();
  }
}

function historyItemToDbRow(
  sessionId: string,
  position: number,
  item: HistoryItem,
): HistoryItemInsert {
  const shared = { sessionId, position, type: item.type };
  switch (item.type) {
    case "llm-ir":
      return { ...shared, content: null, llmIrJson: serializeLlmIr(item.ir) };
    case "notification":
      return { ...shared, content: item.content, llmIrJson: null };
    case "request-failed":
    case "compaction-failed":
      return { ...shared, content: null, llmIrJson: null };
  }
}

function dbRowToHistoryItem(row: HistoryItemDbRow): HistoryItem {
  switch (row.type) {
    case "llm-ir":
      if (row.llmIrJson == null) {
        throw new Error("LLM IR history item is missing llm_ir_json");
      }
      return {
        type: "llm-ir",
        ir: deserializeLlmIr(row.llmIrJson),
      };
    case "notification":
      return {
        type: "notification",
        content: row.content ?? "",
      };
    case "request-failed":
    case "compaction-failed":
      return { type: row.type };
  }
}
