import { Database } from "bun:sqlite";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate as drizzleMigrate } from "drizzle-orm/bun-sqlite/migrator";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { expect, test } from "bun:test";
import journal from "../../drizzle/meta/_journal.json" with { type: "json" };
import { NO_MODEL_RECORDED } from "../session-history/model-json.ts";
import { db } from "./db.ts";
import { migrate, migrateDatabase } from "./migrate.ts";

const migrationsFolder = path.join(import.meta.dirname, "../../drizzle");

function temporaryMigration(statements: string[]) {
  const folder = mkdtempSync(path.join(os.tmpdir(), "octo-migrations-"));
  mkdirSync(path.join(folder, "meta"));
  writeFileSync(
    path.join(folder, "meta/_journal.json"),
    JSON.stringify({
      ...journal,
      entries: [{ idx: 0, version: "6", when: 1, tag: "0000_test", breakpoints: true }],
    }),
  );
  writeFileSync(
    path.join(folder, "0000_test.sql"),
    statements.join("\n--> statement-breakpoint\n"),
  );
  return {
    folder,
    [Symbol.dispose]() {
      rmSync(folder, { recursive: true, force: true });
    },
  };
}

function databaseBeforeModelMigration() {
  const sqlite = new Database(":memory:");
  const previousMigrations = mkdtempSync(path.join(os.tmpdir(), "octo-migrations-"));
  try {
    cpSync(migrationsFolder, previousMigrations, { recursive: true });
    writeFileSync(
      path.join(previousMigrations, "meta/_journal.json"),
      JSON.stringify({
        ...journal,
        entries: journal.entries.filter(entry => entry.idx < 6),
      }),
    );
    sqlite.run("PRAGMA foreign_keys = ON");
    drizzleMigrate(drizzle(sqlite), { migrationsFolder: previousMigrations });
    sqlite.exec(`
      INSERT INTO trees (id, name, cwd, updated_at) VALUES (1, 'saved-session', '/tmp', 1);
      INSERT INTO local_launches (id, unchained) VALUES (1, 0);
      INSERT INTO launches (id, local_launch_id) VALUES (1, 1);
      INSERT INTO request_failed_items (id) VALUES (1);
      INSERT INTO compaction_failed_items (id) VALUES (1);
      INSERT INTO notifications (id, content) VALUES (1, 'saved notification');
      INSERT INTO llm_irs (id, json) VALUES (1, '{"saved":"message"}');
      INSERT INTO history_items (id, request_failed_id) VALUES (1, 1);
      INSERT INTO history_items (id, compaction_failed_id) VALUES (2, 1);
      INSERT INTO history_items (id, notification_id) VALUES (3, 1);
      INSERT INTO history_items (id, llm_ir_id) VALUES (4, 1);
      INSERT INTO tree_nodes
        (id, history_item_id, tree_id, parent_id, is_leaf, launch_id, created_at)
      VALUES
        (1, 1, 1, NULL, 1, 1, 1),
        (2, 2, 1, 1, 1, 1, 2),
        (3, 3, 1, 1, 1, 1, 3),
        (4, 4, 1, 3, 1, 1, 4);
      INSERT INTO previews (session_id, preview, preview_type, updated_at)
      VALUES ('saved-session', 'saved preview', 'latest-user-message', 1);
    `);
    return sqlite;
  } catch (error) {
    sqlite.close();
    throw error;
  } finally {
    rmSync(previousMigrations, { recursive: true, force: true });
  }
}

test("migrations apply to a fresh database", async () => {
  await migrate();
  const tables = (
    db().all(sql.raw("SELECT name FROM sqlite_master WHERE type = 'table'")) as {
      name: string;
    }[]
  ).map(row => row.name);
  expect(tables).toContain("tree_nodes");
  expect(tables).toContain("history_items");
});

test("model migration preserves saved sessions, constraints, and deletion triggers", () => {
  using sqlite = databaseBeforeModelMigration();
  const unchangedTables = [
    "trees",
    "tree_nodes",
    "launches",
    "local_launches",
    "request_failed_items",
    "compaction_failed_items",
    "notifications",
    "llm_irs",
    "previews",
  ];
  const before = unchangedTables.map(table => sqlite.query(`SELECT * FROM ${table}`).all());
  const historyBefore = sqlite
    .query<Record<string, unknown>, []>("SELECT * FROM history_items ORDER BY id")
    .all();
  expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);

  migrateDatabase(sqlite, migrationsFolder);
  // Startup runs migrations again on every launch.
  migrateDatabase(sqlite, migrationsFolder);

  expect(unchangedTables.map(table => sqlite.query(`SELECT * FROM ${table}`).all())).toEqual(
    before,
  );
  expect(sqlite.query("SELECT * FROM history_items ORDER BY id").all()).toEqual(
    historyBefore.map(item => ({ ...item, model_json: NO_MODEL_RECORDED })),
  );
  expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(sqlite.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(() => sqlite.run("UPDATE history_items SET model_json = NULL WHERE id = 1")).toThrow(
    "NOT NULL constraint failed",
  );
  expect(() => sqlite.run("DELETE FROM request_failed_items WHERE id = 1")).toThrow(
    "FOREIGN KEY constraint failed",
  );
  expect(() =>
    sqlite.run("INSERT INTO history_items (request_failed_id, model_json) VALUES (1, 'model')"),
  ).toThrow("UNIQUE constraint failed");

  sqlite.run("DELETE FROM tree_nodes WHERE id = 4");
  expect(sqlite.query("SELECT * FROM history_items WHERE id = 4").all()).toEqual([]);
  expect(sqlite.query("SELECT * FROM llm_irs").all()).toEqual([]);
  expect(sqlite.query("SELECT is_leaf FROM tree_nodes WHERE id = 3").get()).toEqual({
    is_leaf: 1,
  });
  sqlite.run("DELETE FROM trees WHERE id = 1");
  for (const table of [
    "tree_nodes",
    "history_items",
    "request_failed_items",
    "compaction_failed_items",
    "notifications",
    "previews",
  ]) {
    expect(sqlite.query(`SELECT * FROM ${table}`).all()).toEqual([]);
  }
  expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});

test("model migration still rejects missing payloads and rolls back", () => {
  using sqlite = databaseBeforeModelMigration();
  sqlite.run("PRAGMA foreign_keys = OFF");
  sqlite.run("DELETE FROM request_failed_items WHERE id = 1");
  sqlite.run("PRAGMA foreign_keys = ON");
  const historyBefore = sqlite.query("SELECT * FROM history_items ORDER BY id").all();
  const migrationsBefore = sqlite.query("SELECT * FROM __drizzle_migrations").all();

  expect(() => migrateDatabase(sqlite, migrationsFolder)).toThrow(
    "Foreign key violation after migration",
  );

  expect(sqlite.query("SELECT * FROM history_items ORDER BY id").all()).toEqual(historyBefore);
  expect(sqlite.query("SELECT * FROM __drizzle_migrations").all()).toEqual(migrationsBefore);
  expect(sqlite.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(sqlite.inTransaction).toBe(false);
});

test("migrations already applied by Drizzle are not replayed or rewritten", () => {
  using sqlite = new Database(":memory:");
  sqlite.run("PRAGMA foreign_keys = ON");
  // The published migration succeeds on an empty DB, as on existing installations.
  drizzleMigrate(drizzle(sqlite), { migrationsFolder });
  sqlite.exec(`
    INSERT INTO request_failed_items (id) VALUES (1);
    INSERT INTO history_items (id, request_failed_id, model_json) VALUES (1, 1, 'saved model');
  `);
  const migrationsBefore = sqlite.query("SELECT * FROM __drizzle_migrations").all();
  const historyBefore = sqlite.query("SELECT * FROM history_items").all();

  migrateDatabase(sqlite, migrationsFolder);

  expect(sqlite.query("SELECT * FROM __drizzle_migrations").all()).toEqual(migrationsBefore);
  expect(sqlite.query("SELECT * FROM history_items").all()).toEqual(historyBefore);
  expect(sqlite.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
});

test("a newly generated Drizzle rebuild preserves rows referenced with ON DELETE CASCADE", async () => {
  const parents = sqliteTable("parents", {
    id: integer().primaryKey(),
    label: text().notNull(),
  });
  const children = sqliteTable("children", {
    id: integer().primaryKey(),
    parentId: integer("parent_id")
      .notNull()
      .references(() => parents.id, { onDelete: "cascade" }),
  });
  const before = await generateSQLiteDrizzleJson({ parents, children });
  const after = await generateSQLiteDrizzleJson(
    {
      parents: sqliteTable("parents", { id: integer().primaryKey(), label: text() }),
      children,
    },
    before.id,
  );
  using migration = temporaryMigration(await generateSQLiteMigration(before, after));
  using sqlite = new Database(":memory:");
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE parents (id INTEGER PRIMARY KEY NOT NULL, label TEXT NOT NULL);
    CREATE TABLE children (
      id INTEGER PRIMARY KEY NOT NULL,
      parent_id INTEGER NOT NULL REFERENCES parents(id) ON DELETE CASCADE
    );
    INSERT INTO parents VALUES (1, 'parent');
    INSERT INTO children VALUES (1, 1);
  `);

  migrateDatabase(sqlite, migration.folder);

  expect(sqlite.query("SELECT * FROM parents").all()).toEqual([{ id: 1, label: "parent" }]);
  expect(sqlite.query("SELECT * FROM children").all()).toEqual([{ id: 1, parent_id: 1 }]);
  sqlite.run("UPDATE parents SET label = NULL WHERE id = 1");
  expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(() => sqlite.run("INSERT INTO children VALUES (2, 999)")).toThrow(
    "FOREIGN KEY constraint failed",
  );
  sqlite.run("DELETE FROM parents WHERE id = 1");
  expect(sqlite.query("SELECT * FROM children").all()).toEqual([]);
});

test("a migration introducing an orphan rolls back its schema, data, and journal changes", () => {
  using migration = temporaryMigration([
    "ALTER TABLE parents ADD note TEXT;",
    "DELETE FROM parents WHERE id = 1;",
  ]);
  using sqlite = new Database(":memory:");
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE parents (id INTEGER PRIMARY KEY);
    CREATE TABLE children (parent_id INTEGER REFERENCES parents(id));
    INSERT INTO parents VALUES (1);
    INSERT INTO children VALUES (1);
  `);
  const schemaBefore = sqlite.query("SELECT * FROM sqlite_master").all();

  expect(() => migrateDatabase(sqlite, migration.folder)).toThrow(
    "Foreign key violation after migration: children row 1 references parents",
  );

  expect(sqlite.query("SELECT * FROM sqlite_master").all()).toEqual(schemaBefore);
  expect(sqlite.query("SELECT * FROM parents").all()).toEqual([{ id: 1 }]);
  expect(sqlite.query("SELECT * FROM children").all()).toEqual([{ parent_id: 1 }]);
  expect(sqlite.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(sqlite.inTransaction).toBe(false);
});

test.each([0, 1])(
  "SQL errors roll back and restore connection settings (foreign_keys=%i)",
  foreignKeys => {
    using migration = temporaryMigration([
      "CREATE TABLE migration_test (id INTEGER);",
      "PRAGMA legacy_alter_table = ON;",
      "INSERT INTO missing_table VALUES (1);",
    ]);
    using sqlite = new Database(":memory:");
    sqlite.run(`PRAGMA foreign_keys = ${foreignKeys}`);
    sqlite.run("PRAGMA legacy_alter_table = OFF");

    expect(() => migrateDatabase(sqlite, migration.folder)).toThrow("no such table: missing_table");

    expect(sqlite.query("SELECT * FROM sqlite_master").all()).toEqual([]);
    expect(sqlite.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: foreignKeys });
    expect(sqlite.query("PRAGMA legacy_alter_table").get()).toEqual({ legacy_alter_table: 0 });
    expect(sqlite.inTransaction).toBe(false);
  },
);

test("migrations reject an existing transaction before changing foreign-key enforcement", () => {
  using sqlite = new Database(":memory:");
  sqlite.run("PRAGMA foreign_keys = ON");
  sqlite.transaction(() => {
    expect(() => migrateDatabase(sqlite, migrationsFolder)).toThrow(
      "Database migrations must run outside an existing transaction",
    );
    expect(sqlite.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(sqlite.inTransaction).toBe(true);
  })();
});
