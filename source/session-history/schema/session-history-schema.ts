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

export const trees = sqliteTable("trees", {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull().unique(),
  cwd: text().notNull(),
  updatedAt: integer().notNull(),
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

export const historyItems = sqliteTable(
  "history_items",
  {
    id: integer().primaryKey({ autoIncrement: true }),
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

export const treesRelations = relations(trees, ({ many }) => ({
  nodes: many(treeNodes),
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
