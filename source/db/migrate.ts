import type { Database } from "bun:sqlite";
import path from "path";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { isStandaloneExecutable } from "../bun-env.ts";
import { db } from "./db.ts";

const __dir = import.meta.dirname;

export async function migrate() {
  // In dev this is the repo's drizzle/ folder. In compiled binaries build.ts
  // embeds that same directory via `compile.assets` (bun 1.4): node:fs reads
  // then hit the in-bundle filesystem, but every bundled module's
  // import.meta.dir collapses to /$bunfs/root, so the path is "drizzle"
  // relative to this module rather than "../../drizzle/".
  migrateDatabase(
    db().$client,
    path.join(__dir, isStandaloneExecutable() ? "drizzle" : "../../drizzle/"),
  );
}

export function migrateDatabase(sqlite: Database, migrationsFolder: string) {
  if (sqlite.inTransaction) {
    throw new Error("Database migrations must run outside an existing transaction");
  }
  const migrations = readMigrationFiles({ migrationsFolder });
  const foreignKeys = sqlite.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get()!;
  const legacyAlterTable = sqlite
    .query<{ legacy_alter_table: number }, []>("PRAGMA legacy_alter_table")
    .get()!;

  // SQLite's table-rebuild procedure requires disabling foreign keys BEFORE BEGIN.
  // Drizzle's migrator starts the transaction first, making the PRAGMAs in generated
  // SQL ineffective. Own the transaction so we can also validate BEFORE COMMIT:
  // https://www.sqlite.org/lang_altertable.html#making_other_kinds_of_table_schema_changes
  try {
    sqlite.run("PRAGMA foreign_keys = OFF");
    sqlite
      .transaction(() => {
        // Keep Drizzle's journal schema and timestamp-based migration selection so
        // existing installations skip migrations they have already applied.
        sqlite.run(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      )`);
        const lastMigration = sqlite
          .query<
            { created_at: number },
            []
          >("SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1")
          .get();
        const pending = migrations.filter(
          migration => !lastMigration || Number(lastMigration.created_at) < migration.folderMillis,
        );
        if (pending.length === 0) return;

        for (const migration of pending) {
          for (const statement of migration.sql) {
            sqlite.run(statement);
          }
          sqlite.run("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [
            migration.hash,
            migration.folderMillis,
          ]);
        }
        const violation = sqlite
          .query<
            { table: string; rowid: number | null; parent: string },
            []
          >("PRAGMA foreign_key_check")
          .get();
        if (violation) {
          throw new Error(
            `Foreign key violation after migration: ${violation.table} row ${violation.rowid} ` +
              `references ${violation.parent}`,
          );
        }
      })
      .immediate();
  } finally {
    sqlite.run(`PRAGMA foreign_keys = ${foreignKeys.foreign_keys}`);
    // Migration 0006 changes this connection setting; restore it even if it fails.
    sqlite.run(`PRAGMA legacy_alter_table = ${legacyAlterTable.legacy_alter_table}`);
  }
}
