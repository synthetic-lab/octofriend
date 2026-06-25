import { BetterSQLiteTransaction, drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema.ts";
import { DB_PATH } from "./setup.ts";
import { ExtractTablesWithRelations } from "drizzle-orm";

export * as schema from "./schema.ts";

let sqliteDb: Database.Database;
let client: ReturnType<typeof drizzle<typeof schema>>;

export function db() {
  if (sqliteDb == null) {
    if (process.env["NODE_ENV"] === "test") {
      sqliteDb = new Database(":memory:");
    } else {
      sqliteDb = new Database(DB_PATH);
    }
    sqliteDb.pragma("foreign_keys = ON");
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

export type DbTransaction = BetterSQLiteTransaction<
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>; // Drizzle doesn't export the transaction type directly

export function isSqliteBusyError(error: unknown): boolean {
  const code = sqliteErrorCode(error);
  return code === "SQLITE_BUSY" || code === "SQLITE_LOCKED";
}

export function isSqliteConstraint(error: unknown): boolean {
  return sqliteErrorCode(error).startsWith("SQLITE_CONSTRAINT");
}

export function sqliteErrorCode(error: unknown): string {
  if (typeof error !== "object" || error == null || !("code" in error)) return "";
  return String(error.code);
}
