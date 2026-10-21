import type { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate as drizzleMigrate } from "drizzle-orm/bun-sqlite/migrator";
import { readFileSync } from "node:fs";
import path from "path";
import { t } from "structural";
import { isStandaloneExecutable } from "../bun-env.ts";
import { attemptSync, type Result } from "../libocto/result.ts";
import { db } from "./db.ts";

const __dir = import.meta.dirname;

function migrationsFolder(): string {
  // In dev this is the repo's drizzle/ folder. In compiled binaries build.ts
  // embeds that same directory via `compile.assets` (bun 1.4): node:fs reads
  // then hit the in-bundle filesystem, but every bundled module's
  // import.meta.dir collapses to /$bunfs/root, so the path is "drizzle"
  // relative to this module rather than "../../drizzle/".
  return path.join(__dir, isStandaloneExecutable() ? "drizzle" : "../../drizzle/");
}

export async function migrate() {
  migrateDatabase(db().$client, migrationsFolder());
}

// Migration 0006 rebuilds history_items by dropping and recreating it. With foreign keys on,
// DROP TABLE history_items performs an implicit DELETE while tree_nodes rows still reference the
// old table. The migration's PRAGMA defer_foreign_keys only defers that check; it still fails at
// COMMIT even though the rebuilt table has the same IDs. SQLite's table-rebuild procedure
// requires foreign keys to be off before BEGIN, but Drizzle owns the transaction and
// PRAGMA foreign_keys is a no-op inside one. Retry that one failure with foreign keys off, then
// restore the connection's expected PRAGMAs.
const BAD_MIGRATION_TAG = "0006_history_item_model_json";

export function migrateDatabase(sqlite: Database, migrationsFolder: string): void {
  try {
    runMigrations(sqlite, migrationsFolder);
  } catch (error) {
    if (!isForeignKeyConstraintError(error)) throw error;
    if (!isBadMigrationPending(sqlite, migrationsFolder)) throw error;

    sqlite.run("PRAGMA foreign_keys = OFF");
    try {
      runMigrations(sqlite, migrationsFolder);
    } finally {
      sqlite.run("PRAGMA foreign_keys = ON");
      sqlite.run("PRAGMA legacy_alter_table = OFF");
    }
  }
}

function runMigrations(sqlite: Database, migrationsFolder: string): void {
  drizzleMigrate(drizzle({ client: sqlite }), { migrationsFolder });
}

function isForeignKeyConstraintError(error: unknown): boolean {
  for (
    let current: unknown = error;
    current != null;
    current = (current as { cause?: unknown }).cause
  ) {
    const candidate = current as { code?: unknown; message?: unknown };
    if (
      candidate.code === "SQLITE_CONSTRAINT_FOREIGNKEY" ||
      candidate.message === "FOREIGN KEY constraint failed"
    ) {
      return true;
    }
  }
  return false;
}

const MigrationJournalSchema = t.subtype({
  entries: t.array(
    t.subtype({
      tag: t.str,
      when: t.num,
    }),
  ),
});
type MigrationJournal = t.GetType<typeof MigrationJournalSchema>;

function readMigrationJournal(migrationsFolder: string): Result<MigrationJournal, string> {
  return attemptSync(`Invalid migration journal in ${migrationsFolder}`, () =>
    MigrationJournalSchema.slice(
      JSON.parse(readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8")),
    ),
  );
}

const LAST_APPLIED_MIGRATION_SQL =
  "SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1";

function isBadMigrationPending(sqlite: Database, migrationsFolder: string): boolean {
  // Match by tag rather than a hardcoded timestamp. The journal's `when` is committed, so
  // Drizzle's pending check is exactly `lastAppliedAt < thatMigration.when`.
  const journal = readMigrationJournal(migrationsFolder);
  if (!journal.success) return false;
  const badMigration = journal.data.entries.find(entry => entry.tag === BAD_MIGRATION_TAG);
  if (badMigration == null) return false;

  let lastAppliedAt: number | null;
  try {
    const row = sqlite.query<{ created_at: number | null }, []>(LAST_APPLIED_MIGRATION_SQL).get();
    lastAppliedAt = row?.created_at ?? null;
  } catch {
    // Drizzle creates the migrations table before opening its transaction, so it should exist
    // after a failed migrate; if it doesn't, we can't tie the failure to the known-bad migration.
    return false;
  }

  return lastAppliedAt == null || lastAppliedAt < badMigration.when;
}
