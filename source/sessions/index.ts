import crypto from "crypto";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db } from "../db/db.ts";
import { sessionsTable, sessionMessagesTable } from "./schema/sessions-table.ts";
import { HistoryItem, seedSequenceId } from "../history.ts";

const SESSION_TITLE_MAX = 80;

function newSessionId(): string {
  return crypto.randomUUID();
}

export type SessionMetadata = {
  id: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  title: string | null;
};

function bigintReplacer(_: string, value: unknown) {
  if (typeof value === "bigint") return { __bigint: value.toString() };
  return value;
}

function bigintReviver(_: string, value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    "__bigint" in value &&
    typeof (value as { __bigint: unknown }).__bigint === "string"
  ) {
    return BigInt((value as { __bigint: string }).__bigint);
  }
  return value;
}

export class SessionStore {
  private persistedSeqs: Set<string>;
  private writeChain: Promise<void> = Promise.resolve();
  private persisted: boolean;

  constructor(
    public readonly id: string,
    public readonly cwd: string,
    private title: string | null,
    private initialHistory: HistoryItem[],
    persisted: boolean = true,
  ) {
    this.persistedSeqs = new Set(initialHistory.map(item => item.id.toString()));
    this.persisted = persisted;
  }

  getInitialHistory(): HistoryItem[] {
    return this.initialHistory;
  }

  getTitle(): string | null {
    return this.title;
  }

  isPersisted(): boolean {
    return this.persisted;
  }

  persistHistory(history: HistoryItem[]): Promise<void> {
    this.writeChain = this.writeChain
      .then(() => this.persistHistoryInner(history))
      .catch(e => {
        console.error("Failed to persist session history:", e);
      });
    return this.writeChain;
  }

  private async persistHistoryInner(history: HistoryItem[]): Promise<void> {
    // Lazy session creation: don't insert the session row until there's a
    // user message in the history. This avoids recording empty sessions.
    if (!this.persisted) {
      const hasUserMessage = history.some(item => item.type === "user");
      if (!hasUserMessage) return;
      const now = Date.now();
      db()
        .insert(sessionsTable)
        .values({ id: this.id, cwd: this.cwd, createdAt: now, updatedAt: now, title: null })
        .run();
      this.persisted = true;
    }

    const currentSeqs = new Set(history.map(item => item.id.toString()));

    const toDelete: string[] = [];
    for (const seq of this.persistedSeqs) {
      if (!currentSeqs.has(seq)) toDelete.push(seq);
    }

    const toInsert = history.filter(item => !this.persistedSeqs.has(item.id.toString()));

    const inferredTitle = this.title ?? deriveTitle(history);

    db().transaction(tx => {
      if (toDelete.length > 0) {
        tx.delete(sessionMessagesTable)
          .where(
            and(
              eq(sessionMessagesTable.sessionId, this.id),
              inArray(sessionMessagesTable.seq, toDelete),
            ),
          )
          .run();
      }

      if (toInsert.length > 0) {
        const rows = toInsert.map(item => ({
          sessionId: this.id,
          seq: item.id.toString(),
          seqOrder: Number(item.id),
          data: JSON.stringify(item, bigintReplacer),
        }));
        tx.insert(sessionMessagesTable).values(rows).run();
      }

      tx.update(sessionsTable)
        .set({
          updatedAt: Date.now(),
          ...(inferredTitle !== this.title ? { title: inferredTitle } : {}),
        })
        .where(eq(sessionsTable.id, this.id))
        .run();
    });

    for (const seq of toDelete) this.persistedSeqs.delete(seq);
    for (const item of toInsert) this.persistedSeqs.add(item.id.toString());
    if (inferredTitle !== this.title) this.title = inferredTitle;
  }
}

function deriveTitle(history: HistoryItem[]): string | null {
  const firstUser = history.find(item => item.type === "user");
  if (!firstUser) return null;
  const flat = firstUser.content.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return null;
  if (flat.length <= SESSION_TITLE_MAX) return flat;
  return flat.slice(0, SESSION_TITLE_MAX - 1) + "…";
}

export function createSession(cwd: string): SessionStore {
  const id = newSessionId();
  return new SessionStore(id, cwd, null, [], false);
}

export function findLatestSession(cwd: string): SessionMetadata | null {
  const row = db()
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.cwd, cwd))
    .orderBy(sql`${sessionsTable.updatedAt} desc`)
    .limit(1)
    .all();
  return row[0] ?? null;
}

export function resolveSessionId(idOrPrefix: string): SessionMetadata | null {
  const exact = db()
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, idOrPrefix))
    .limit(1)
    .all();
  if (exact.length > 0) return exact[0];

  const matches = db()
    .select()
    .from(sessionsTable)
    .where(like(sessionsTable.id, `${idOrPrefix}%`))
    .limit(2)
    .all();
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new SessionResumeError(`Session id "${idOrPrefix}" is ambiguous. Use a longer prefix.`);
  }
  return matches[0];
}

export function loadSession(idOrPrefix: string): SessionStore {
  const meta = resolveSessionId(idOrPrefix);
  if (!meta) throw new SessionResumeError(`No session found for id "${idOrPrefix}".`);
  return loadSessionByMetadata(meta);
}

export function loadSessionByMetadata(meta: SessionMetadata): SessionStore {
  const rows = db()
    .select({ data: sessionMessagesTable.data, seq: sessionMessagesTable.seq })
    .from(sessionMessagesTable)
    .where(eq(sessionMessagesTable.sessionId, meta.id))
    .orderBy(sessionMessagesTable.seqOrder)
    .all();

  const history = rows.map(row => JSON.parse(row.data, bigintReviver) as HistoryItem);

  let maxSeq = 0n;
  for (const item of history) {
    if (item.id > maxSeq) maxSeq = item.id;
  }
  seedSequenceId(maxSeq + 1n);

  return new SessionStore(meta.id, meta.cwd, meta.title, history, true);
}

export function listSessions(opts: { cwd?: string; limit?: number } = {}): SessionMetadata[] {
  const limit = opts.limit ?? 50;
  const base = db().select().from(sessionsTable);
  const filtered = opts.cwd ? base.where(eq(sessionsTable.cwd, opts.cwd)) : base;
  return filtered
    .orderBy(sql`${sessionsTable.updatedAt} desc`)
    .limit(limit)
    .all();
}

export function deleteSession(id: string): void {
  db().delete(sessionsTable).where(eq(sessionsTable.id, id)).run();
}

export function countMessages(sessionId: string): number {
  const rows = db()
    .select({ count: sql<number>`count(*)` })
    .from(sessionMessagesTable)
    .where(eq(sessionMessagesTable.sessionId, sessionId))
    .all();
  return rows[0]?.count ?? 0;
}

export class SessionResumeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionResumeError";
  }
}
