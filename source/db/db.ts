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
    sqliteDb.run("PRAGMA foreign_keys = ON");
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
