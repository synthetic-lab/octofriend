import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const inputHistoryTable = sqliteTable("input_history", {
  id: integer().primaryKey({ autoIncrement: true }),
  createdAt: integer({ mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  input: text().notNull(),
}, table => [
  index("createdAt_idx").on(table.createdAt),
]);
