import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const sessionsTable = sqliteTable(
  "sessions",
  {
    id: text().primaryKey(),
    cwd: text().notNull(),
    createdAt: integer().notNull(),
    updatedAt: integer().notNull(),
    title: text(),
  },
  table => [index("sessions_cwd_updated_at_idx").on(table.cwd, table.updatedAt)],
);

export const sessionMessagesTable = sqliteTable(
  "session_messages",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    sessionId: text()
      .notNull()
      .references(() => sessionsTable.id, { onDelete: "cascade" }),
    seq: text().notNull(),
    seqOrder: integer().notNull(),
    data: text().notNull(),
  },
  table => [index("session_messages_session_seq_idx").on(table.sessionId, table.seqOrder)],
);
