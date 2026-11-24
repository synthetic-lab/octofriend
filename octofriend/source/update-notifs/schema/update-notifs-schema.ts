import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

export const shownUpdateNotifs = sqliteTable(
  "shown_update_notifs",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    update: text().notNull(),
  },
  table => [uniqueIndex("update_idx").on(table.update)],
);
