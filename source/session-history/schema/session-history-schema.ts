import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const historySessions = sqliteTable(
  "history_sessions",
  {
    id: text().primaryKey(),
    createdAt: integer().notNull(),
    updatedAt: integer().notNull(),
    cwd: text().notNull(),
    transportKind: text({ enum: ["local", "docker"] }).notNull(),
    launchCommandArgsJson: text().notNull(),
  },
  table => [
    index("history_sessions_cwd_updated_at_idx").on(table.cwd, table.updatedAt),
    index("history_sessions_updated_at_idx").on(table.updatedAt),
  ],
);

export const historyItems = sqliteTable(
  "history_items",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    sessionId: text()
      .notNull()
      .references(() => historySessions.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    type: text({
      enum: ["llm-ir", "request-failed", "compaction-failed", "notification"],
    }).notNull(),
    content: text(),
    llmIrJson: text(),
  },
  table => [uniqueIndex("history_items_session_position_idx").on(table.sessionId, table.position)],
);
