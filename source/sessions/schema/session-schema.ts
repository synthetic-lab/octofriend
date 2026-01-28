import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const sessionsTable = sqliteTable("sessions", {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  lastActiveAt: integer({ mode: "timestamp" }).notNull(),
  model: text().notNull(),
});

export const messagesTable = sqliteTable("messages", {
  id: integer().primaryKey({ autoIncrement: true }),
  sessionId: integer()
    .notNull()
    .references(() => sessionsTable.id, { onDelete: "cascade" }),
  sequenceId: integer().notNull(), // To match HistoryItem.id
  data: text().notNull(), // JSON blob of HistoryItem
  createdAt: integer({ mode: "timestamp" }).notNull(),
});
