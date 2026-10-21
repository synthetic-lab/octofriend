import { Database } from "bun:sqlite";
import { SQLiteBunTransaction, drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.ts";
import { DB_PATH } from "./setup.ts";
import { ExtractTablesWithRelations } from "drizzle-orm";

export * as schema from "./schema.ts";

let sqliteDb: Database;
let client: ReturnType<typeof drizzle<typeof schema>>;

export type DbTransaction = SQLiteBunTransaction<
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>; // Drizzle doesn't export the transaction type directly

export function db() {
  if (sqliteDb == null) {
    if (process.env["NODE_ENV"] === "test") {
      sqliteDb = new Database(":memory:");
    } else {
      sqliteDb = new Database(DB_PATH);
    }
    // Connection/database invariants are set explicitly so the expected state lives here rather
    // than being implied by SQLite defaults. busy_timeout comes first: switching to WAL and
    // running migrations may need to wait on another Octo process with the database open.
    sqliteDb.run("PRAGMA busy_timeout = 5000");
    sqliteDb.run("PRAGMA journal_mode = WAL");
    // WAL + NORMAL stays corruption-safe, but a power loss can lose recent commits. We accept
    // that because the sync API means a FULL fsync per commit would block the TUI event loop.
    sqliteDb.run("PRAGMA synchronous = NORMAL");
    sqliteDb.run("PRAGMA foreign_keys = ON");
    sqliteDb.run("PRAGMA legacy_alter_table = OFF");
  }
  if (client == null) {
    client = drizzle({
      client: sqliteDb,
      casing: "snake_case",
      schema,
    });
  }
  return client;
}
