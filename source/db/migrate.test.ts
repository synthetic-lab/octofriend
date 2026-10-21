import { Database } from "bun:sqlite";
import { sql, type TablesRelationalConfig } from "drizzle-orm";
import { SQLiteBunSession } from "drizzle-orm/bun-sqlite";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { expect, test } from "bun:test";
import path from "node:path";
import { NO_MODEL_RECORDED } from "../session-history/model-json.ts";
import { db } from "./db.ts";
import { migrate, migrateDatabase } from "./migrate.ts";

const migrationsFolder = path.join(import.meta.dirname, "../../drizzle");
const migrations = readMigrationFiles({ migrationsFolder });

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

test("migration 0006 repairs existing installations automatically", () => {
  const sqlite = new Database(":memory:");
  try {
    // The production connection enables foreign keys; the bad migration only fails with them on.
    sqlite.run("PRAGMA foreign_keys = ON");

    // Bring an existing installation to the schema just before migration 0006.
    const dialect = new SQLiteSyncDialect();
    dialect.migrate(
      migrations.slice(0, 6),
      new SQLiteBunSession<Record<string, unknown>, TablesRelationalConfig>(
        sqlite,
        dialect,
        undefined,
      ),
      undefined,
    );
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
      INSERT INTO tree_nodes (id, history_item_id, tree_id, parent_id, is_leaf, launch_id, created_at)
      VALUES
        (1, 1, 1, NULL, 1, 1, 1),
        (2, 2, 1, 1, 1, 1, 2),
        (3, 3, 1, 1, 1, 1, 3),
        (4, 4, 1, 3, 1, 1, 4);
      INSERT INTO previews (session_id, preview, preview_type, updated_at)
      VALUES ('saved-session', 'saved preview', 'latest-user-message', 1);
    `);

    // Startup migrates on every launch, so the repair must be a no-op the second time.
    migrateDatabase(sqlite, migrationsFolder);
    migrateDatabase(sqlite, migrationsFolder);

    expect(sqlite.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(sqlite.query("PRAGMA legacy_alter_table").get()).toEqual({ legacy_alter_table: 0 });
    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(sqlite.query("SELECT * FROM request_failed_items").all()).toEqual([{ id: 1 }]);
    expect(sqlite.query("SELECT * FROM tree_nodes ORDER BY id").all()).toHaveLength(4);
    expect(sqlite.query("SELECT model_json FROM history_items ORDER BY id").all()).toEqual([
      { model_json: NO_MODEL_RECORDED },
      { model_json: NO_MODEL_RECORDED },
      { model_json: NO_MODEL_RECORDED },
      { model_json: NO_MODEL_RECORDED },
    ]);
    expect(
      sqlite
        .query("SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1")
        .get(),
    ).toEqual({ created_at: migrations[6]!.folderMillis });
    expect(sqlite.inTransaction).toBe(false);
  } finally {
    sqlite.close();
  }
});
