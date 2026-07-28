import { relations, sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const trees = sqliteTable(
  "trees",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    name: text().notNull().unique(),
    cwd: text().notNull(),
    updatedAt: integer()
      .notNull()
      .$onUpdate(() => Date.now()),
  },
  table => [index("trees_cwd_updated_at_idx").on(table.cwd, sql`${table.updatedAt} DESC`)],
);

export const previews = sqliteTable("previews", {
  sessionId: text()
    .notNull()
    .primaryKey()
    .references(() => trees.name, { onDelete: "cascade" }),
  preview: text(),
  previewType: text({ enum: ["latest-user-message"] }).notNull(),
  updatedAt: integer()
    .notNull()
    .$onUpdate(() => Date.now()),
});

export const localLaunches = sqliteTable("local_launches", {
  id: integer().primaryKey({ autoIncrement: true }),
  config: text(),
  unchained: integer({ mode: "boolean" }).notNull(),
});

export const dockerLaunches = sqliteTable(
  "docker_launches",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    kind: text({ enum: ["connect", "run"] }).notNull(),
    containerTarget: text(),
    dockerRunArgsJson: text(),
    config: text(),
    unchained: integer({ mode: "boolean" }).notNull(),
  },
  table => [
    check(
      "docker_launches_kind_args_check",
      sql`(${table.kind} = 'connect' AND ${table.containerTarget} IS NOT NULL AND ${table.dockerRunArgsJson} IS NULL)
        OR (${table.kind} = 'run' AND ${table.containerTarget} IS NULL AND ${table.dockerRunArgsJson} IS NOT NULL)`,
    ),
  ],
);

export const launches = sqliteTable(
  "launches",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    dockerLaunchId: integer().references(() => dockerLaunches.id),
    localLaunchId: integer().references(() => localLaunches.id),
  },
  table => [
    unique().on(table.dockerLaunchId),
    unique().on(table.localLaunchId),
    check(
      "launches_exactly_one_kind_check",
      sql`(${table.dockerLaunchId} IS NOT NULL) <> (${table.localLaunchId} IS NOT NULL)`,
    ),
  ],
);

export const requestFailedItems = sqliteTable("request_failed_items", {
  id: integer().primaryKey({ autoIncrement: true }),
});

export const compactionFailedItems = sqliteTable("compaction_failed_items", {
  id: integer().primaryKey({ autoIncrement: true }),
});

export const notifications = sqliteTable("notifications", {
  id: integer().primaryKey({ autoIncrement: true }),
  content: text().notNull(),
});

export const llmIrs = sqliteTable("llm_irs", {
  id: integer().primaryKey({ autoIncrement: true }),
  json: text().notNull(),
});

/*
 * Deletion of history items and their payloads is handled by AFTER DELETE triggers in
 * drizzle/0003_tree_node_triggers.sql, NOT by FK cascades — drizzle schemas can't express
 * triggers, so you must read that migration file to see the full deletion behavior. (The FK
 * arrows here point from each row to the rows it was built from, which is opposite the
 * deletion order, so cascades can't express it.) The `restrict` actions below make the trigger
 * chain the only deletion path: payloads can't be deleted while a history item references them.
 */
export const historyItems = sqliteTable(
  "history_items",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    modelNickname: text(),
    requestFailedId: integer().references(() => requestFailedItems.id, { onDelete: "restrict" }),
    compactionFailedId: integer().references(() => compactionFailedItems.id, {
      onDelete: "restrict",
    }),
    notificationId: integer().references(() => notifications.id, { onDelete: "restrict" }),
    llmIrId: integer().references(() => llmIrs.id, { onDelete: "restrict" }),
  },
  table => [
    unique().on(table.requestFailedId),
    unique().on(table.compactionFailedId),
    unique().on(table.notificationId),
    unique().on(table.llmIrId),
    check(
      "history_items_exactly_one_payload_check",
      sql`(${table.requestFailedId} IS NOT NULL)
        + (${table.compactionFailedId} IS NOT NULL)
        + (${table.notificationId} IS NOT NULL)
        + (${table.llmIrId} IS NOT NULL) = 1`,
    ),
  ],
);

export const treeNodes = sqliteTable(
  "tree_nodes",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    // No onDelete action here on purpose: deleting a tree node must delete its history item
    // (a child delete propagating to the parent), which FKs can't express. The
    // tree_nodes_delete_history_item trigger handles it; see the comment above historyItems.
    historyItemId: integer()
      .notNull()
      .references(() => historyItems.id),
    treeId: integer()
      .notNull()
      .references(() => trees.id, { onDelete: "cascade" }),
    parentId: integer(),
    isLeaf: integer({ mode: "boolean" }).notNull(),
    launchId: integer()
      .notNull()
      .references(() => launches.id),
    createdAt: integer()
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  table => [
    index("tree_nodes_tree_id_idx").on(table.treeId),
    unique().on(table.historyItemId),
    unique().on(table.id, table.treeId),
    uniqueIndex("tree_nodes_one_root_unique")
      .on(table.treeId)
      .where(sql`${table.parentId} IS NULL`),
    foreignKey({
      name: "tree_nodes_parent_same_tree_fk",
      columns: [table.parentId, table.treeId],
      foreignColumns: [table.id, table.treeId],
    }).onDelete("cascade"),
    check(
      "tree_nodes_not_own_parent_check",
      sql`${table.parentId} IS NULL OR ${table.parentId} <> ${table.id}`,
    ),
  ],
);

export const treesRelations = relations(trees, ({ many, one }) => ({
  nodes: many(treeNodes),
  preview: one(previews),
}));

export const previewsRelations = relations(previews, ({ one }) => ({
  tree: one(trees, {
    fields: [previews.sessionId],
    references: [trees.name],
  }),
}));

export const treeNodesRelations = relations(treeNodes, ({ one }) => ({
  tree: one(trees, {
    fields: [treeNodes.treeId],
    references: [trees.id],
  }),
  historyItem: one(historyItems, {
    fields: [treeNodes.historyItemId],
    references: [historyItems.id],
  }),
  launch: one(launches, {
    fields: [treeNodes.launchId],
    references: [launches.id],
  }),
}));

export const historyItemsRelations = relations(historyItems, ({ one }) => ({
  requestFailedItem: one(requestFailedItems, {
    fields: [historyItems.requestFailedId],
    references: [requestFailedItems.id],
  }),
  compactionFailedItem: one(compactionFailedItems, {
    fields: [historyItems.compactionFailedId],
    references: [compactionFailedItems.id],
  }),
  notification: one(notifications, {
    fields: [historyItems.notificationId],
    references: [notifications.id],
  }),
  llmIr: one(llmIrs, {
    fields: [historyItems.llmIrId],
    references: [llmIrs.id],
  }),
}));

export const launchesRelations = relations(launches, ({ one }) => ({
  local: one(localLaunches, {
    fields: [launches.localLaunchId],
    references: [localLaunches.id],
  }),
  docker: one(dockerLaunches, {
    fields: [launches.dockerLaunchId],
    references: [dockerLaunches.id],
  }),
}));
