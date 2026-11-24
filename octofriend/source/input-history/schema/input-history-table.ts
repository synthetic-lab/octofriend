import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const inputHistoryTable = sqliteTable("input_history", {
  id: integer().primaryKey({ autoIncrement: true }),
  input: text().notNull(),
});
