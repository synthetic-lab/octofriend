import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const inputHistoryTable = sqliteTable("input_history", {
  id: integer().primaryKey({ autoIncrement: true }),
  timestamp: integer({ mode: "timestamp" }).notNull(),
  input: text().notNull(),
}, table => [
  index("timestamp_idx").on(table.timestamp),
]);
